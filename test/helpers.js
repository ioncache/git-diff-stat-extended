/**
 * Creates a minimal report object suitable for rendering and CLI tests.
 *
 * @param {Partial<import('../src/gdsx-cli.js').CliReport>} [overrides={}] - Optional report overrides.
 * @returns {import('../src/gdsx-cli.js').CliReport} CLI report object.
 */
function createReport(overrides = {}) {
  const report = {
    shortstatLine: "1 file changed, 1 insertion(+), 1 deletion(-)",
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
    range: "HEAD~1..HEAD",
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
    process.argv = ["node", "gdsx", ...argv];
    process.exitCode = 0;
    if (cwd) {
      process.chdir(cwd);
    }

    console.log = (...args) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args) => {
      errors.push(args.map(String).join(" "));
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

export { createReport, executeCliWithMain };
