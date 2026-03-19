const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { generateStats, reconcileTotals } = require('../gdsx-lib');

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function writeFile(repo, relativePath, content) {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function commitAll(repo, message) {
  run('git', ['add', '-A'], repo);
  run('git', ['commit', '-m', message], repo);
}

function createRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gdsx-test-'));
  run('git', ['init'], repo);
  run('git', ['config', 'user.name', 'gdsx-test'], repo);
  run('git', ['config', 'user.email', 'gdsx-test@example.com'], repo);
  return repo;
}

test('category classification and reconciliation across implementation/test/comment lines', () => {
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
      "test('sum works', () => {",
      '  expect(sum(1, 1)).toBe(3);',
      '});',
      '',
    ].join('\n')
  );
  commitAll(repo, 'add test and comment change');

  const report = generateStats({ cwd: repo, base: 'HEAD~1', head: 'HEAD' });

  assert.equal(report.reconciliation.pass, true);
  assert.ok(report.categories.implementation.insertions > 0 || report.categories.implementation.deletions > 0);
  assert.ok(report.categories.comments.insertions > 0);
  assert.ok(report.categories.tests.insertions > 0);
});

test('reconciliation helper reports mismatches', () => {
  const result = reconcileTotals(
    { insertions: 5, deletions: 3 },
    {
      implementation: { insertions: 1, deletions: 1 },
      tests: { insertions: 1, deletions: 1 },
      comments: { insertions: 1, deletions: 0 },
    }
  );

  assert.equal(result.pass, false);
  assert.equal(result.expected.insertions, 5);
  assert.equal(result.computed.insertions, 3);
});

test('range handling supports explicit range expressions', () => {
  const repo = createRepo();

  writeFile(repo, 'src/value.js', 'module.exports = 1;\n');
  commitAll(repo, 'c1');

  writeFile(repo, 'src/value.js', 'module.exports = 2;\n');
  commitAll(repo, 'c2');

  writeFile(repo, 'src/value.js', 'module.exports = 3;\n');
  commitAll(repo, 'c3');

  const a = generateStats({ cwd: repo, base: 'HEAD~2', head: 'HEAD~1' });
  const b = generateStats({ cwd: repo, range: 'HEAD~2..HEAD~1' });

  assert.deepEqual(a.total, b.total);
  assert.deepEqual(a.categories, b.categories);
  assert.equal(a.reconciliation.pass, true);
});

test('include and exclude globs filter selected files', () => {
  const repo = createRepo();

  writeFile(repo, 'src/main.js', 'module.exports = 1;\n');
  writeFile(repo, 'tests/main.test.js', 'test("a", () => {});\n');
  commitAll(repo, 'baseline');

  writeFile(repo, 'src/main.js', '// keep\nmodule.exports = 2;\n');
  writeFile(repo, 'tests/main.test.js', 'test("a", () => { expect(1).toBe(1); });\n');
  commitAll(repo, 'change src and test');

  const includeSrcOnly = generateStats({
    cwd: repo,
    base: 'HEAD~1',
    head: 'HEAD',
    include: ['src/**'],
  });

  assert.equal(includeSrcOnly.categories.tests.insertions, 0);
  assert.equal(includeSrcOnly.reconciliation.pass, true);

  const excludeTests = generateStats({
    cwd: repo,
    base: 'HEAD~1',
    head: 'HEAD',
    exclude: ['**/*.test.js'],
  });

  assert.equal(excludeTests.categories.tests.insertions, 0);
  assert.equal(excludeTests.reconciliation.pass, true);
});

test('rename changes are handled without reconciliation drift', () => {
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

  const report = generateStats({ cwd: repo, base: 'HEAD~1', head: 'HEAD' });

  assert.equal(report.reconciliation.pass, true);
  assert.ok(report.total.filesChanged >= 1);
  assert.ok(report.categories.tests.insertions > 0 || report.categories.tests.deletions > 0);
});

test('rename with large unchanged body does not inflate insertions', () => {
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

  const report = generateStats({ cwd: repo, base: 'HEAD~1', head: 'HEAD' });
  assert.equal(report.reconciliation.pass, true);
  assert.equal(report.total.insertions, report.reconciliation.computed.insertions);
  assert.equal(report.total.deletions, report.reconciliation.computed.deletions);
});
