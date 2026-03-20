import { describe, it, expect, vi } from 'vitest';

const { createRepo } = globalThis.gdsxTestUtils;

/**
 * Creates a minimal report object suitable for rendering tests.
 *
 * @param {Partial<import('../src/gdsx-cli.js').CliReport>} [overrides={}] - Optional report overrides.
 * @returns {import('../src/gdsx-cli.js').CliReport} CLI report object.
 */
function createReport(overrides = {}) {
  const report = {
    shortstatLine: '1 file changed, 1 insertion(+), 1 deletion(-)',
    total: {
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
    },
    categories: {
      implementation: { insertions: 1, deletions: 1 },
      tests: { insertions: 0, deletions: 0 },
      comments: { insertions: 0, deletions: 0 },
      documentation: { insertions: 0, deletions: 0 },
      configuration: { insertions: 0, deletions: 0 },
    },
    reconciliation: {
      pass: true,
      expected: { insertions: 1, deletions: 1 },
      computed: { insertions: 1, deletions: 1 },
    },
    range: 'HEAD~1..HEAD',
    filters: { include: [], exclude: [] },
    selectedFiles: [],
    fileDetails: [],
  };

  return {
    ...report,
    ...overrides,
    total: { ...report.total, ...(overrides.total || {}) },
    categories: { ...report.categories, ...(overrides.categories || {}) },
    reconciliation: {
      ...report.reconciliation,
      ...(overrides.reconciliation || {}),
      expected: {
        ...report.reconciliation.expected,
        ...((overrides.reconciliation && overrides.reconciliation.expected) || {}),
      },
      computed: {
        ...report.reconciliation.computed,
        ...((overrides.reconciliation && overrides.reconciliation.computed) || {}),
      },
    },
    filters: { ...report.filters, ...(overrides.filters || {}) },
  };
}

/**
 * Executes a provided CLI main function with temporary process and console overrides.
 *
 * @param {() => void} cliMain - CLI main function to run.
 * @param {{ argv: string[], cwd?: string }} options - Runtime options.
 * @returns {{ logs: string[], errors: string[], exitCode: number }} Captured CLI execution result.
 */
function executeCliWithMain(cliMain, options) {
  const { argv, cwd } = options;
  const previousArgv = process.argv;
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const previousLog = console.log;
  const previousError = console.error;
  const logs = [];
  const errors = [];

  try {
    process.argv = ['node', 'gdsx', ...argv];
    process.exitCode = 0;
    if (cwd) {
      process.chdir(cwd);
    }

    console.log = (...args) => {
      logs.push(args.map(String).join(' '));
    };
    console.error = (...args) => {
      errors.push(args.map(String).join(' '));
    };

    cliMain();

    return {
      logs,
      errors,
      exitCode: process.exitCode ?? 0,
    };
  } finally {
    process.argv = previousArgv;
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    console.log = previousLog;
    console.error = previousError;
  }
}

describe('gdsx-render', () => {
  describe('color resolution', () => {
    it('should disable color output when NO_COLOR is set', async () => {
      // Arrange
      const repo = createRepo();
      const previousNoColor = process.env.NO_COLOR;
      const previousForceColor = process.env.FORCE_COLOR;

      process.env.NO_COLOR = '1';
      delete process.env.FORCE_COLOR;

      vi.resetModules();
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => createReport(),
      }));

      // Act
      const { main } = await import('../src/gdsx-cli.js');
      const result = executeCliWithMain(main, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD'],
        cwd: repo,
      });

      // Assert
      expect(result.logs.join('\n')).not.toContain('\u001b[');

      // Revert
      if (previousNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previousNoColor;
      }
      if (previousForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = previousForceColor;
      }
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();
    });

    it('should honor git color.ui settings when env color flags are absent', async () => {
      // Arrange
      const repo = createRepo();
      const previousNoColor = process.env.NO_COLOR;
      const previousForceColor = process.env.FORCE_COLOR;
      delete process.env.NO_COLOR;
      delete process.env.FORCE_COLOR;

      // Act
      vi.resetModules();
      vi.doMock('node:child_process', () => ({
        spawnSync: (command, args) => {
          if (command === 'git' && args[0] === 'config') {
            return { status: 0, stdout: 'always\n', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        },
      }));
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => createReport(),
      }));
      const { main: alwaysMain } = await import('../src/gdsx-cli.js');
      const alwaysResult = executeCliWithMain(alwaysMain, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD'],
        cwd: repo,
      });

      vi.doUnmock('node:child_process');
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();

      vi.doMock('node:child_process', () => ({
        spawnSync: (command, args) => {
          if (command === 'git' && args[0] === 'config') {
            return { status: 0, stdout: 'never\n', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        },
      }));
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => createReport(),
      }));
      const { main: neverMain } = await import('../src/gdsx-cli.js');
      const neverResult = executeCliWithMain(neverMain, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD'],
        cwd: repo,
      });

      // Assert
      expect(alwaysResult.logs.join('\n')).toContain('\u001b[');
      expect(neverResult.logs.join('\n')).not.toContain('\u001b[');

      // Revert
      if (previousNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previousNoColor;
      }
      if (previousForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = previousForceColor;
      }
      vi.doUnmock('node:child_process');
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();
    });

    it('should honor FORCE_COLOR when NO_COLOR is not set', async () => {
      // Arrange
      const repo = createRepo();
      const previousNoColor = process.env.NO_COLOR;
      const previousForceColor = process.env.FORCE_COLOR;
      delete process.env.NO_COLOR;
      process.env.FORCE_COLOR = '0';

      vi.resetModules();
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => createReport(),
      }));

      // Act
      const { main } = await import('../src/gdsx-cli.js');
      const result = executeCliWithMain(main, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD'],
        cwd: repo,
      });

      // Assert
      expect(result.logs.join('\n')).not.toContain('\u001b[');

      // Revert
      if (previousNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previousNoColor;
      }
      if (previousForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = previousForceColor;
      }
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();
    });
  });

  describe('renderTextOutput', () => {
    it('should render plural file labels and negative net values in text output', async () => {
      // Arrange
      const repo = createRepo();
      const report = createReport({
        total: {
          filesChanged: 2,
          insertions: 2,
          deletions: 3,
        },
        categories: {
          implementation: { insertions: 1, deletions: 3 },
          tests: { insertions: 1, deletions: 0 },
          comments: { insertions: 0, deletions: 0 },
          documentation: { insertions: 0, deletions: 0 },
          configuration: { insertions: 0, deletions: 0 },
        },
        reconciliation: {
          pass: true,
          expected: { insertions: 2, deletions: 3 },
          computed: { insertions: 2, deletions: 3 },
        },
      });

      vi.resetModules();
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => report,
      }));
      const { main } = await import('../src/gdsx-cli.js');

      // Act
      const result = executeCliWithMain(main, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD'],
        cwd: repo,
      });
      const output = result.logs.join('\n');

      // Assert
      expect(output).toContain('2 files changed');
      expect(output).toContain('·');
      expect(output).toContain('-2');
      expect(output).not.toContain('reconciliation:');

      // Revert
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();
    });
  });

  describe('renderReconciliation', () => {
    it('should show reconciliation line on pass when --show-reconciliation is set', async () => {
      // Arrange
      const repo = createRepo();

      vi.resetModules();
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => createReport(),
      }));
      const { main } = await import('../src/gdsx-cli.js');

      // Act
      const result = executeCliWithMain(main, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD', '--show-reconciliation'],
        cwd: repo,
      });
      const output = result.logs.join('\n');

      // Assert
      expect(result.exitCode).toBe(0);
      expect(output).toContain('PASS reconciliation:');

      // Revert
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();
    });

    it('should hide reconciliation line on pass by default', async () => {
      // Arrange
      const repo = createRepo();

      vi.resetModules();
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => createReport(),
      }));
      const { main } = await import('../src/gdsx-cli.js');

      // Act
      const result = executeCliWithMain(main, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD'],
        cwd: repo,
      });
      const output = result.logs.join('\n');

      // Assert
      expect(result.exitCode).toBe(0);
      expect(output).not.toContain('reconciliation:');

      // Revert
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();
    });

    it('should always show reconciliation line on fail regardless of flag', async () => {
      // Arrange
      const repo = createRepo();
      const failReport = createReport({
        categories: {
          implementation: { insertions: 1, deletions: 0 },
          tests: { insertions: 0, deletions: 0 },
          comments: { insertions: 0, deletions: 0 },
          documentation: { insertions: 0, deletions: 0 },
          configuration: { insertions: 0, deletions: 0 },
        },
        reconciliation: {
          pass: false,
          expected: { insertions: 1, deletions: 1 },
          computed: { insertions: 1, deletions: 0 },
        },
      });

      vi.resetModules();
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => failReport,
      }));
      const { main } = await import('../src/gdsx-cli.js');

      // Act
      const result = executeCliWithMain(main, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD'],
        cwd: repo,
      });
      const output = result.logs.join('\n');

      // Assert
      expect(result.exitCode).toBe(1);
      expect(output).toContain('FAIL reconciliation:');

      // Revert
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();
    });
  });

  describe('renderGroupedTextOutput', () => {
    it('should render grouped output by extension when --group-by-extension is set', async () => {
      // Arrange
      const repo = createRepo();
      const report = createReport({
        total: { filesChanged: 3, insertions: 5, deletions: 2 },
        categories: {
          implementation: { insertions: 3, deletions: 1 },
          tests: { insertions: 2, deletions: 1 },
          comments: { insertions: 0, deletions: 0 },
          documentation: { insertions: 0, deletions: 0 },
          configuration: { insertions: 0, deletions: 0 },
        },
        reconciliation: {
          pass: true,
          expected: { insertions: 5, deletions: 2 },
          computed: { insertions: 5, deletions: 2 },
        },
      });
      report.fileDetails = [
        {
          path: 'src/app.js',
          categories: {
            implementation: { insertions: 2, deletions: 1 },
            tests: { insertions: 0, deletions: 0 },
            comments: { insertions: 0, deletions: 0 },
            documentation: { insertions: 0, deletions: 0 },
            configuration: { insertions: 0, deletions: 0 },
          },
        },
        {
          path: 'src/utils.js',
          categories: {
            implementation: { insertions: 1, deletions: 0 },
            tests: { insertions: 0, deletions: 0 },
            comments: { insertions: 0, deletions: 0 },
            documentation: { insertions: 0, deletions: 0 },
            configuration: { insertions: 0, deletions: 0 },
          },
        },
        {
          path: 'tests/app.test.js',
          categories: {
            implementation: { insertions: 0, deletions: 0 },
            tests: { insertions: 2, deletions: 1 },
            comments: { insertions: 0, deletions: 0 },
            documentation: { insertions: 0, deletions: 0 },
            configuration: { insertions: 0, deletions: 0 },
          },
        },
      ];

      vi.resetModules();
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => report,
      }));
      const { main } = await import('../src/gdsx-cli.js');

      // Act
      const result = executeCliWithMain(main, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD', '--group-by-extension'],
        cwd: repo,
      });
      const output = result.logs.join('\n');

      // Assert
      expect(result.exitCode).toBe(0);
      expect(output).toContain('.js');
      expect(output).toContain('3 files');
      expect(output).toContain('implementation');
      expect(output).toContain('tests');
      expect(output).toContain('comments');
      expect(output).toContain('total');

      // Revert
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();
    });

    it('should group multiple extensions separately in grouped output', async () => {
      // Arrange
      const repo = createRepo();
      const report = createReport({
        total: { filesChanged: 2, insertions: 3, deletions: 1 },
        categories: {
          implementation: { insertions: 2, deletions: 1 },
          tests: { insertions: 0, deletions: 0 },
          comments: { insertions: 1, deletions: 0 },
          documentation: { insertions: 0, deletions: 0 },
          configuration: { insertions: 0, deletions: 0 },
        },
        reconciliation: {
          pass: true,
          expected: { insertions: 3, deletions: 1 },
          computed: { insertions: 3, deletions: 1 },
        },
      });
      report.fileDetails = [
        {
          path: 'src/app.js',
          categories: {
            implementation: { insertions: 2, deletions: 1 },
            tests: { insertions: 0, deletions: 0 },
            comments: { insertions: 0, deletions: 0 },
            documentation: { insertions: 0, deletions: 0 },
            configuration: { insertions: 0, deletions: 0 },
          },
        },
        {
          path: 'src/style.css',
          categories: {
            implementation: { insertions: 0, deletions: 0 },
            tests: { insertions: 0, deletions: 0 },
            comments: { insertions: 1, deletions: 0 },
            documentation: { insertions: 0, deletions: 0 },
            configuration: { insertions: 0, deletions: 0 },
          },
        },
      ];

      vi.resetModules();
      vi.doMock('../src/gdsx-lib.js', () => ({
        generateStats: () => report,
      }));
      const { main } = await import('../src/gdsx-cli.js');

      // Act
      const result = executeCliWithMain(main, {
        argv: ['--base', 'HEAD~1', '--head', 'HEAD', '--group-by-extension'],
        cwd: repo,
      });
      const output = result.logs.join('\n');

      // Assert
      expect(output).toContain('.js');
      expect(output).toContain('.css');
      expect(output).toContain('1 file');

      // Revert
      vi.doUnmock('../src/gdsx-lib.js');
      vi.resetModules();
    });
  });
});
