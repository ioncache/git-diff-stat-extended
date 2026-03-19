import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  classifyPatchText,
  generateStats,
  isTestPath,
  parseCommentsByLine,
  parseRawDiffZ,
  parseShortstat,
  reconcileTotals,
} from "../src/gdsx-lib.js";

const { run, writeFile, commitAll, createRepo } = globalThis.gdsxTestUtils;

describe("gdsx-lib", () => {
  it("classifies implementation, tests, and comments while reconciling totals", () => {
    // Arrange
    const repo = createRepo();

    writeFile(
      repo,
      "src/app.js",
      ["function sum(a, b) {", "  return a + b;", "}", "", "module.exports = { sum };", ""].join(
        "\n",
      ),
    );
    commitAll(repo, "initial implementation");

    writeFile(
      repo,
      "src/app.js",
      [
        "function sum(a, b) {",
        "  // implementation note",
        "  return a + b + 1;",
        "}",
        "",
        "module.exports = { sum };",
        "",
      ].join("\n"),
    );
    writeFile(
      repo,
      "tests/app.test.js",
      [
        "const { sum } = require('../src/app');",
        "",
        "it('sum works', () => {",
        "  expect(sum(1, 1)).toBe(3);",
        "});",
        "",
      ].join("\n"),
    );
    commitAll(repo, "add test and comment change");

    // Act
    const report = generateStats({ cwd: repo, base: "HEAD~1", head: "HEAD" });

    // Assert
    expect(report.reconciliation.pass).toBe(true);
    expect(
      report.categories.implementation.insertions > 0 ||
        report.categories.implementation.deletions > 0,
    ).toBe(true);
    expect(report.categories.comments.insertions).toBeGreaterThan(0);
    expect(report.categories.tests.insertions).toBeGreaterThan(0);
  });

  it("reports mismatch details when reconciliation fails", () => {
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

  it("supports explicit range expressions", () => {
    // Arrange
    const repo = createRepo();

    writeFile(repo, "src/value.js", "module.exports = 1;\n");
    commitAll(repo, "c1");

    writeFile(repo, "src/value.js", "module.exports = 2;\n");
    commitAll(repo, "c2");

    writeFile(repo, "src/value.js", "module.exports = 3;\n");
    commitAll(repo, "c3");

    // Act
    const withBaseHead = generateStats({
      cwd: repo,
      base: "HEAD~2",
      head: "HEAD~1",
    });
    const withRange = generateStats({ cwd: repo, range: "HEAD~2..HEAD~1" });

    // Assert
    expect(withBaseHead.total).toEqual(withRange.total);
    expect(withBaseHead.categories).toEqual(withRange.categories);
    expect(withBaseHead.reconciliation.pass).toBe(true);
  });

  it("applies include and exclude globs to selected files", () => {
    // Arrange
    const repo = createRepo();

    writeFile(repo, "src/main.js", "module.exports = 1;\n");
    writeFile(repo, "tests/main.test.js", 'it("a", () => {});\n');
    commitAll(repo, "baseline");

    writeFile(repo, "src/main.js", "// keep\nmodule.exports = 2;\n");
    writeFile(repo, "tests/main.test.js", 'it("a", () => { expect(1).toBe(1); });\n');
    commitAll(repo, "change src and test");

    // Act
    const includeSrcOnly = generateStats({
      cwd: repo,
      base: "HEAD~1",
      head: "HEAD",
      include: ["src/**"],
    });

    const excludeTests = generateStats({
      cwd: repo,
      base: "HEAD~1",
      head: "HEAD",
      exclude: ["**/*.test.js"],
    });

    // Assert
    expect(includeSrcOnly.categories.tests.insertions).toBe(0);
    expect(includeSrcOnly.reconciliation.pass).toBe(true);
    expect(excludeTests.categories.tests.insertions).toBe(0);
    expect(excludeTests.reconciliation.pass).toBe(true);
  });

  it("accepts single-string include and exclude patterns", () => {
    // Arrange
    const repo = createRepo();

    writeFile(repo, "src/main.js", "module.exports = 1;\n");
    writeFile(repo, "tests/main.test.js", 'it("a", () => {});\n');
    commitAll(repo, "baseline");

    writeFile(repo, "src/main.js", "module.exports = 2;\n");
    writeFile(repo, "tests/main.test.js", 'it("a", () => { expect(1).toBe(1); });\n');
    commitAll(repo, "change src and test");

    // Act
    const includeAsString = generateStats({
      cwd: repo,
      base: "HEAD~1",
      head: "HEAD",
      include: "src/**",
    });
    const excludeAsString = generateStats({
      cwd: repo,
      base: "HEAD~1",
      head: "HEAD",
      exclude: "**/*.test.js",
    });

    // Assert
    expect(includeAsString.categories.tests.insertions).toBe(0);
    expect(includeAsString.reconciliation.pass).toBe(true);
    expect(excludeAsString.categories.tests.insertions).toBe(0);
    expect(excludeAsString.reconciliation.pass).toBe(true);
  });

  it("handles rename changes without reconciliation drift", () => {
    // Arrange
    const repo = createRepo();

    writeFile(repo, "src/thing.js", ["function value() {", "  return 1;", "}", ""].join("\n"));
    commitAll(repo, "add impl file");

    fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
    run("git", ["mv", "src/thing.js", "tests/thing.test.js"], repo);
    writeFile(
      repo,
      "tests/thing.test.js",
      ["function value() {", "  // moved to tests", "  return 2;", "}", ""].join("\n"),
    );
    commitAll(repo, "rename and modify");

    // Act
    const report = generateStats({ cwd: repo, base: "HEAD~1", head: "HEAD" });

    // Assert
    expect(report.reconciliation.pass).toBe(true);
    expect(report.total.filesChanged).toBeGreaterThanOrEqual(1);
    expect(report.categories.tests.insertions > 0 || report.categories.tests.deletions > 0).toBe(
      true,
    );
  });

  it("does not inflate insertions for rename with mostly unchanged body", () => {
    // Arrange
    const repo = createRepo();

    const lines = [];
    for (let i = 1; i <= 200; i += 1) {
      lines.push(`const line${i} = ${i};`);
    }

    writeFile(repo, "src/big.js", `${lines.join("\n")}\n`);
    commitAll(repo, "add big source file");

    fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
    run("git", ["mv", "src/big.js", "tests/big.test.js"], repo);

    const nextLines = [...lines];
    nextLines[50] = "const line51 = 5100;";
    writeFile(repo, "tests/big.test.js", `${nextLines.join("\n")}\n`);
    commitAll(repo, "rename big file and tweak one line");

    // Act
    const report = generateStats({ cwd: repo, base: "HEAD~1", head: "HEAD" });

    // Assert
    expect(report.reconciliation.pass).toBe(true);
    expect(report.total.insertions).toBe(report.reconciliation.computed.insertions);
    expect(report.total.deletions).toBe(report.reconciliation.computed.deletions);
  });

  it("falls back to root diff for the default range in a single-commit repository", () => {
    // Arrange
    const repo = createRepo();
    const emptyTreeSha = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    writeFile(repo, "src/first.js", "module.exports = 1;\n");
    commitAll(repo, "initial commit");

    // Act
    const report = generateStats({ cwd: repo });

    // Assert
    expect(report.range).toBe(`${emptyTreeSha}..HEAD`);
    expect(report.total.filesChanged).toBeGreaterThan(0);
    expect(report.reconciliation.pass).toBe(true);
  });

  it("should throw when raw diff metadata tokens are malformed", () => {
    // Arrange
    const invalidRaw = "not-a-raw-token\0src/value.js\0";

    // Act
    const readRaw = () => parseRawDiffZ(invalidRaw);

    // Assert
    expect(readRaw).toThrow("Unable to parse git raw diff metadata token");
  });

  it("should return no entries for empty raw diff output", () => {
    // Arrange
    const rawText = "";

    // Act
    const entries = parseRawDiffZ(rawText);

    // Assert
    expect(entries).toEqual([]);
  });

  it("should skip empty metadata tokens in raw diff output", () => {
    // Arrange
    const rawText = "\0:100644 100644 a1 b2 M\0src/value.js\0";

    // Act
    const entries = parseRawDiffZ(rawText);

    // Assert
    expect(entries).toHaveLength(1);
    expect(entries[0].displayPath).toBe("src/value.js");
  });

  it("should keep totals unchanged for hunk context-only lines", () => {
    // Arrange
    const patch = ["@@ -1,1 +1,1 @@", " unchanged"].join("\n");
    const entry = {
      oldPath: "src/value.js",
      newPath: "src/value.js",
      oldSha: "1111111",
      newSha: "2222222",
    };

    // Act
    const result = classifyPatchText(patch, entry, () => new Set());

    // Assert
    expect(result).toEqual({
      implementation: { insertions: 0, deletions: 0 },
      tests: { insertions: 0, deletions: 0 },
      comments: { insertions: 0, deletions: 0 },
    });
  });

  it("should return empty category totals when patch text is empty", () => {
    // Arrange
    const entry = {
      oldPath: "src/value.js",
      newPath: "src/value.js",
      oldSha: "1111111",
      newSha: "2222222",
    };

    // Act
    const result = classifyPatchText("", entry, () => new Set());

    // Assert
    expect(result).toEqual({
      implementation: { insertions: 0, deletions: 0 },
      tests: { insertions: 0, deletions: 0 },
      comments: { insertions: 0, deletions: 0 },
    });
  });

  it("should classify as implementation when diff side path is missing", () => {
    // Arrange
    const patch = ["@@ -0,0 +1,1 @@", "+const value = 1;"].join("\n");
    const entry = {
      oldPath: "src/value.js",
      newPath: null,
      oldSha: "1111111",
      newSha: "0000000",
    };

    // Act
    const result = classifyPatchText(patch, entry, () => new Set());

    // Assert
    expect(result.implementation.insertions).toBe(1);
    expect(result.tests.insertions).toBe(0);
    expect(result.comments.insertions).toBe(0);
  });

  it("should continue with a warning when comment parsing fails in verbose mode", () => {
    // Arrange
    const repo = createRepo();
    writeFile(repo, "src/broken.ts", "export const value = 1;\n");
    commitAll(repo, "baseline");
    writeFile(repo, "src/broken.ts", "export const value = 2;\n/*\n");
    commitAll(repo, "introduce broken syntax");

    const previousStderrWrite = process.stderr.write;
    let stderrOutput = "";
    process.stderr.write = (chunk, ...rest) => {
      stderrOutput += String(chunk);
      void rest;
      return true;
    };

    // Act
    let report;
    try {
      report = generateStats({
        cwd: repo,
        base: "HEAD~1",
        head: "HEAD",
        verbose: true,
      });
    } finally {
      process.stderr.write = previousStderrWrite;
    }

    // Assert
    expect(report.reconciliation.pass).toBe(true);
    const warningLines = stderrOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(warningLines).toHaveLength(1);
    expect(warningLines[0]).toMatch(
      /^warning: Unable to parse src\/broken\.ts for comments: Unterminated comment\./,
    );

    // Revert
    expect(process.stderr.write).toBe(previousStderrWrite);
  });

  it("should parse comments in TSX files using the TSX plugin path", () => {
    // Arrange
    const source = [
      "export function Widget() {",
      "  return (",
      "    <div>",
      "      {/* inline tsx comment */}",
      "    </div>",
      "  );",
      "}",
      "",
    ].join("\n");

    // Act
    const lines = parseCommentsByLine(source, "src/widget.tsx");

    // Assert
    expect(lines.has(4)).toBe(true);
  });

  it("should parse comments in JSX files using the JSX plugin path", () => {
    // Arrange
    const source = [
      "export const view = (",
      "  <section>",
      "    {/* inline jsx comment */}",
      "  </section>",
      ");",
      "",
    ].join("\n");

    // Act
    const lines = parseCommentsByLine(source, "src/view.jsx");

    // Assert
    expect(lines.has(3)).toBe(true);
  });

  it("should return zero counts for an empty shortstat line", () => {
    // Arrange
    const input = "";

    // Act
    const parsed = parseShortstat(input);

    // Assert
    expect(parsed).toEqual({
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      raw: "",
    });
  });

  it("should treat empty paths as non-test paths", () => {
    // Arrange
    const filePath = "";

    // Act
    const result = isTestPath(filePath);

    // Assert
    expect(result).toBe(false);
  });
});
