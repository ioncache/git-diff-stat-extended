import { describe, it, expect, vi } from "vitest";

import { main as runCliMain } from "../src/gdsx-cli.js";
import { writeFile, commitAll, createRepo } from "./setup.js";
import { createReport, executeCliWithMain } from "./helpers.js";

/**
 * Executes the CLI main function with temporary process and console overrides.
 *
 * @param {{ argv: string[], cwd?: string }} options - Runtime options.
 * @returns {{ logs: string[], errors: string[], exitCode: number }} Captured CLI execution result.
 */
function executeCli(options) {
  return executeCliWithMain(runCliMain, options);
}

describe("gdsx-cli", () => {
  it("should emit JSON output from the CLI for a valid git range", () => {
    // Arrange
    const repo = createRepo();
    writeFile(repo, "src/value.js", "module.exports = 1;\n");
    commitAll(repo, "c1");
    writeFile(repo, "src/value.js", "module.exports = 2;\n");
    commitAll(repo, "c2");

    // Act
    const result = executeCli({
      argv: ["--json", "HEAD~1..HEAD"],
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

  it("should emit text output from the CLI when json mode is not requested", () => {
    // Arrange
    const repo = createRepo();
    writeFile(repo, "src/value.js", "module.exports = 1;\n");
    commitAll(repo, "c1");
    writeFile(repo, "src/value.js", "module.exports = 2;\n");
    commitAll(repo, "c2");

    // Act
    const result = executeCli({
      argv: ["HEAD~1..HEAD"],
      cwd: repo,
    });
    const stdout = result.logs.join("\n");

    // Assert
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("file changed");
    expect(stdout).toContain("Category");
    expect(stdout).not.toContain("reconciliation:");

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
    vi.doMock("../src/gdsx-lib.js", () => ({
      generateStats: () => mockedReport,
    }));
    const { main } = await import("../src/gdsx-cli.js");

    // Act
    const result = executeCliWithMain(main, {
      argv: ["HEAD~1..HEAD"],
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
      argv: ["HEAD~1..HEAD"],
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
