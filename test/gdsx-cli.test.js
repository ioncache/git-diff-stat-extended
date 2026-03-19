import { describe, it, expect, vi } from "vitest";

import { main as runCliMain } from "../src/gdsx-cli.js";

const { writeFile, commitAll, createRepo } = globalThis.gdsxTestUtils;

/**
 * Creates a minimal report object suitable for CLI rendering tests.
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
    },
    reconciliation: {
      pass: true,
      expected: { insertions: 1, deletions: 1 },
      computed: { insertions: 1, deletions: 1 },
    },
    range: "HEAD~1..HEAD",
    filters: { include: [], exclude: [] },
    selectedFiles: [],
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
 * Executes the CLI main function with temporary process and console overrides.
 *
 * @param {{ argv: string[], cwd?: string }} options - Runtime options.
 * @returns {{ logs: string[], errors: string[], exitCode: number }} Captured CLI execution result.
 */
function executeCli(options) {
  return executeCliWithMain(runCliMain, options);
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

describe("gdsx", () => {
  it("should emit JSON output from the CLI for a valid git range", () => {
    // Arrange
    const repo = createRepo();
    writeFile(repo, "src/value.js", "module.exports = 1;\n");
    commitAll(repo, "c1");
    writeFile(repo, "src/value.js", "module.exports = 2;\n");
    commitAll(repo, "c2");

    // Act
    const result = executeCli({
      argv: ["--base", "HEAD~1", "--head", "HEAD", "--json"],
      cwd: repo,
    });
    const parsed = JSON.parse(result.logs.join("\n"));

    // Assert
    expect(result.exitCode).toBe(0);
    expect(parsed.reconciliation.pass).toBe(true);
    expect(parsed.total.filesChanged).toBeGreaterThan(0);

    // Revert
    expect(result.errors).toHaveLength(0);
  });

  it("should fail with a non-zero exit code for incompatible range flags", () => {
    // Arrange
    const repo = createRepo();

    // Act
    const result = executeCli({
      argv: ["--range", "HEAD~1..HEAD", "--base", "HEAD~1"],
      cwd: repo,
    });

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toContain("Use either --range or --base/--head, not both.");

    // Revert
    expect(result.logs).toHaveLength(0);
  });

  it("should emit text output from the CLI when json mode is not requested", () => {
    // Arrange
    const repo = createRepo();
    writeFile(repo, "src/value.js", "module.exports = 1;\n");
    commitAll(repo, "c1");
    writeFile(repo, "src/value.js", "module.exports = 2;\n");
    commitAll(repo, "c2");

    // Act
    const result = executeCli({
      argv: ["--base", "HEAD~1", "--head", "HEAD"],
      cwd: repo,
    });
    const stdout = result.logs.join("\n");

    // Assert
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("file changed");
    expect(stdout).toContain("Category");
    expect(stdout).toContain("reconciliation:");

    // Revert
    expect(result.errors).toHaveLength(0);
  });

  it("should set exit code to non-zero when reconciliation fails in text mode", async () => {
    // Arrange
    const repo = createRepo();
    const mockedReport = createReport({
      categories: {
        implementation: { insertions: 1, deletions: 0 },
        tests: { insertions: 0, deletions: 0 },
        comments: { insertions: 0, deletions: 0 },
      },
      reconciliation: {
        pass: false,
        expected: { insertions: 1, deletions: 1 },
        computed: { insertions: 1, deletions: 0 },
      },
    });

    vi.resetModules();
    vi.doMock("../src/gdsx-lib.js", () => ({
      generateStats: () => mockedReport,
    }));
    const { main } = await import("../src/gdsx-cli.js");

    // Act
    const result = executeCliWithMain(main, {
      argv: ["--base", "HEAD~1", "--head", "HEAD"],
      cwd: repo,
    });

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.logs.join("\n")).toContain("reconciliation:");
    expect(result.errors.join("\n")).toContain("Diagnostics:");

    // Revert
    vi.doUnmock("../src/gdsx-lib.js");
    vi.resetModules();
  });

  it("should disable color output when NO_COLOR is set", async () => {
    // Arrange
    const repo = createRepo();
    const previousNoColor = process.env.NO_COLOR;
    const previousForceColor = process.env.FORCE_COLOR;

    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;

    vi.resetModules();
    vi.doMock("../src/gdsx-lib.js", () => ({
      generateStats: () => createReport(),
    }));

    // Act
    const { main } = await import("../src/gdsx-cli.js");
    const result = executeCliWithMain(main, {
      argv: ["--base", "HEAD~1", "--head", "HEAD"],
      cwd: repo,
    });

    // Assert
    expect(result.logs.join("\n")).not.toContain("\u001b[");

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
    vi.doUnmock("../src/gdsx-lib.js");
    vi.resetModules();
  });

  it("should honor git color.ui settings when env color flags are absent", async () => {
    // Arrange
    const repo = createRepo();
    const previousNoColor = process.env.NO_COLOR;
    const previousForceColor = process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;

    // Act
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawnSync: (command, args) => {
        if (command === "git" && args[0] === "config") {
          return { status: 0, stdout: "always\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    }));
    vi.doMock("../src/gdsx-lib.js", () => ({
      generateStats: () => createReport(),
    }));
    const { main: alwaysMain } = await import("../src/gdsx-cli.js");
    const alwaysResult = executeCliWithMain(alwaysMain, {
      argv: ["--base", "HEAD~1", "--head", "HEAD"],
      cwd: repo,
    });

    vi.doUnmock("node:child_process");
    vi.doUnmock("../src/gdsx-lib.js");
    vi.resetModules();

    vi.doMock("node:child_process", () => ({
      spawnSync: (command, args) => {
        if (command === "git" && args[0] === "config") {
          return { status: 0, stdout: "never\n", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    }));
    vi.doMock("../src/gdsx-lib.js", () => ({
      generateStats: () => createReport(),
    }));
    const { main: neverMain } = await import("../src/gdsx-cli.js");
    const neverResult = executeCliWithMain(neverMain, {
      argv: ["--base", "HEAD~1", "--head", "HEAD"],
      cwd: repo,
    });

    // Assert
    expect(alwaysResult.logs.join("\n")).toContain("\u001b[");
    expect(neverResult.logs.join("\n")).not.toContain("\u001b[");

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
    vi.doUnmock("node:child_process");
    vi.doUnmock("../src/gdsx-lib.js");
    vi.resetModules();
  });

  it("should honor FORCE_COLOR when NO_COLOR is not set", async () => {
    // Arrange
    const repo = createRepo();
    const previousNoColor = process.env.NO_COLOR;
    const previousForceColor = process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "0";

    vi.resetModules();
    vi.doMock("../src/gdsx-lib.js", () => ({
      generateStats: () => createReport(),
    }));

    // Act
    const { main } = await import("../src/gdsx-cli.js");
    const result = executeCliWithMain(main, {
      argv: ["--base", "HEAD~1", "--head", "HEAD"],
      cwd: repo,
    });

    // Assert
    expect(result.logs.join("\n")).not.toContain("\u001b[");

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
    vi.doUnmock("../src/gdsx-lib.js");
    vi.resetModules();
  });

  it("should render plural shortstat labels and negative net values in text output", async () => {
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
      },
      reconciliation: {
        pass: true,
        expected: { insertions: 2, deletions: 3 },
        computed: { insertions: 2, deletions: 3 },
      },
    });

    vi.resetModules();
    vi.doMock("../src/gdsx-lib.js", () => ({
      generateStats: () => report,
    }));
    const { main } = await import("../src/gdsx-cli.js");

    // Act
    const result = executeCliWithMain(main, {
      argv: ["--base", "HEAD~1", "--head", "HEAD"],
      cwd: repo,
    });
    const output = result.logs.join("\n");

    // Assert
    expect(output).toContain("2 files changed, 2 insertions(+), 3 deletions(-)");
    expect(output).toContain("-2");

    // Revert
    vi.doUnmock("../src/gdsx-lib.js");
    vi.resetModules();
  });

  it("should stringify non-Error throw values in CLI error handling", async () => {
    // Arrange
    const repo = createRepo();

    vi.resetModules();
    vi.doMock("../src/gdsx-lib.js", () => ({
      generateStats: () => {
        throw 42;
      },
    }));
    const { main } = await import("../src/gdsx-cli.js");

    // Act
    const result = executeCliWithMain(main, {
      argv: ["--base", "HEAD~1", "--head", "HEAD"],
      cwd: repo,
    });

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toContain("gdsx error: 42");

    // Revert
    vi.doUnmock("../src/gdsx-lib.js");
    vi.resetModules();
  });
});
