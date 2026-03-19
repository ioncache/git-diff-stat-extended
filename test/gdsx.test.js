import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { generateStats, reconcileTotals } from '../gdsx-lib.js';
const { run, writeFile, commitAll, createRepo } = globalThis.gdsxTestUtils;

describe('gdsx', () => {
  it('classifies implementation, tests, and comments while reconciling totals', () => {
    // Arrange
    const repo = createRepo();

    writeFile(
      repo,
      'src/app.js',
      [
        'function sum(a, b) {',
        '  return a + b;',
        '}',
        '',
        'module.exports = { sum };',
        '',
      ].join('\n')
    );
    commitAll(repo, 'initial implementation');

    writeFile(
      repo,
      'src/app.js',
      [
        'function sum(a, b) {',
        '  // implementation note',
        '  return a + b + 1;',
        '}',
        '',
        'module.exports = { sum };',
        '',
      ].join('\n')
    );
    writeFile(
      repo,
      'tests/app.test.js',
      [
        "const { sum } = require('../src/app');",
        '',
        "it('sum works', () => {",
        '  expect(sum(1, 1)).toBe(3);',
        '});',
        '',
      ].join('\n')
    );
    commitAll(repo, 'add test and comment change');

    // Act
    const report = generateStats({ cwd: repo, base: 'HEAD~1', head: 'HEAD' });

    // Assert
    expect(report.reconciliation.pass).toBe(true);
    expect(report.categories.implementation.insertions > 0 || report.categories.implementation.deletions > 0).toBe(true);
    expect(report.categories.comments.insertions).toBeGreaterThan(0);
    expect(report.categories.tests.insertions).toBeGreaterThan(0);
  });

  it('reports mismatch details when reconciliation fails', () => {
    // Arrange
    const total = { insertions: 5, deletions: 3 };
    const categories = {
      implementation: { insertions: 1, deletions: 1 },
      tests: { insertions: 1, deletions: 1 },
      comments: { insertions: 1, deletions: 0 },
    };

    // Act
    const result = reconcileTotals(total, categories);

    // Assert
    expect(result.pass).toBe(false);
    expect(result.expected.insertions).toBe(5);
    expect(result.computed.insertions).toBe(3);
  });

  it('supports explicit range expressions', () => {
    // Arrange
    const repo = createRepo();

    writeFile(repo, 'src/value.js', 'module.exports = 1;\n');
    commitAll(repo, 'c1');

    writeFile(repo, 'src/value.js', 'module.exports = 2;\n');
    commitAll(repo, 'c2');

    writeFile(repo, 'src/value.js', 'module.exports = 3;\n');
    commitAll(repo, 'c3');

    // Act
    const withBaseHead = generateStats({ cwd: repo, base: 'HEAD~2', head: 'HEAD~1' });
    const withRange = generateStats({ cwd: repo, range: 'HEAD~2..HEAD~1' });

    // Assert
    expect(withBaseHead.total).toEqual(withRange.total);
    expect(withBaseHead.categories).toEqual(withRange.categories);
    expect(withBaseHead.reconciliation.pass).toBe(true);
  });

  it('applies include and exclude globs to selected files', () => {
    // Arrange
    const repo = createRepo();

    writeFile(repo, 'src/main.js', 'module.exports = 1;\n');
    writeFile(repo, 'tests/main.test.js', 'it("a", () => {});\n');
    commitAll(repo, 'baseline');

    writeFile(repo, 'src/main.js', '// keep\nmodule.exports = 2;\n');
    writeFile(repo, 'tests/main.test.js', 'it("a", () => { expect(1).toBe(1); });\n');
    commitAll(repo, 'change src and test');

    // Act
    const includeSrcOnly = generateStats({
      cwd: repo,
      base: 'HEAD~1',
      head: 'HEAD',
      include: ['src/**'],
    });

    const excludeTests = generateStats({
      cwd: repo,
      base: 'HEAD~1',
      head: 'HEAD',
      exclude: ['**/*.test.js'],
    });

    // Assert
    expect(includeSrcOnly.categories.tests.insertions).toBe(0);
    expect(includeSrcOnly.reconciliation.pass).toBe(true);
    expect(excludeTests.categories.tests.insertions).toBe(0);
    expect(excludeTests.reconciliation.pass).toBe(true);
  });

  it('handles rename changes without reconciliation drift', () => {
    // Arrange
    const repo = createRepo();

    writeFile(repo, 'src/thing.js', ['function value() {', '  return 1;', '}', ''].join('\n'));
    commitAll(repo, 'add impl file');

    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    run('git', ['mv', 'src/thing.js', 'tests/thing.test.js'], repo);
    writeFile(
      repo,
      'tests/thing.test.js',
      ['function value() {', '  // moved to tests', '  return 2;', '}', ''].join('\n')
    );
    commitAll(repo, 'rename and modify');

    // Act
    const report = generateStats({ cwd: repo, base: 'HEAD~1', head: 'HEAD' });

    // Assert
    expect(report.reconciliation.pass).toBe(true);
    expect(report.total.filesChanged).toBeGreaterThanOrEqual(1);
    expect(report.categories.tests.insertions > 0 || report.categories.tests.deletions > 0).toBe(true);
  });

  it('does not inflate insertions for rename with mostly unchanged body', () => {
    // Arrange
    const repo = createRepo();

    const lines = [];
    for (let i = 1; i <= 200; i += 1) {
      lines.push(`const line${i} = ${i};`);
    }

    writeFile(repo, 'src/big.js', `${lines.join('\n')}\n`);
    commitAll(repo, 'add big source file');

    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    run('git', ['mv', 'src/big.js', 'tests/big.test.js'], repo);

    const nextLines = [...lines];
    nextLines[50] = 'const line51 = 5100;';
    writeFile(repo, 'tests/big.test.js', `${nextLines.join('\n')}\n`);
    commitAll(repo, 'rename big file and tweak one line');

    // Act
    const report = generateStats({ cwd: repo, base: 'HEAD~1', head: 'HEAD' });

    // Assert
    expect(report.reconciliation.pass).toBe(true);
    expect(report.total.insertions).toBe(report.reconciliation.computed.insertions);
    expect(report.total.deletions).toBe(report.reconciliation.computed.deletions);
  });

  it('falls back to root diff for the default range in a single-commit repository', () => {
    // Arrange
    const repo = createRepo();
    const emptyTreeSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    writeFile(repo, 'src/first.js', 'module.exports = 1;\n');
    commitAll(repo, 'initial commit');

    // Act
    const report = generateStats({ cwd: repo });

    // Assert
    expect(report.range).toBe(`${emptyTreeSha}..HEAD`);
    expect(report.total.filesChanged).toBeGreaterThan(0);
    expect(report.reconciliation.pass).toBe(true);
  });
});
