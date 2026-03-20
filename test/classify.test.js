import { describe, it, expect } from "vitest";

import {
  classifyPatchText,
  isTestPath,
  isDocPath,
  isConfigPath,
  getCommentSyntax,
  parseCommentsByLine,
  parseCommentsByLineGeneric,
  reconcileTotals,
} from "../src/classify.js";

describe("classify", () => {
  describe("reconcileTotals", () => {
    it("should report mismatch details when reconciliation fails", () => {
      // Arrange
      const total = { insertions: 5, deletions: 3 };
      const categories = {
        implementation: { insertions: 1, deletions: 1 },
        tests: { insertions: 1, deletions: 1 },
        comments: { insertions: 1, deletions: 0 },
        documentation: { insertions: 0, deletions: 0 },
        configuration: { insertions: 0, deletions: 0 },
      };

      // Act
      const result = reconcileTotals(total, categories);

      // Assert
      expect(result.pass).toBe(false);
      expect(result.expected.insertions).toBe(5);
      expect(result.computed.insertions).toBe(3);
    });
  });

  describe("classifyPatchText", () => {
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
        documentation: { insertions: 0, deletions: 0 },
        configuration: { insertions: 0, deletions: 0 },
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
        documentation: { insertions: 0, deletions: 0 },
        configuration: { insertions: 0, deletions: 0 },
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

    it("should classify insertions as comments when provider returns matching line", () => {
      // Arrange
      const patch = ["@@ -0,0 +1,2 @@", "+// a comment", "+const x = 1;"].join("\n");
      const entry = {
        oldPath: null,
        newPath: "src/value.js",
        oldSha: "0000000",
        newSha: "abc1234",
      };
      const commentLineProvider = () => new Set([1]);

      // Act
      const result = classifyPatchText(patch, entry, commentLineProvider);

      // Assert
      expect(result.comments.insertions).toBe(1);
      expect(result.implementation.insertions).toBe(1);
    });

    it("should call comment provider even when SHA is all zeros", () => {
      // Arrange
      const patch = ["@@ -0,0 +1,1 @@", "+// looks like a comment"].join("\n");
      const entry = {
        oldPath: null,
        newPath: "src/value.js",
        oldSha: "0000000",
        newSha: "0000000",
      };
      let providerCalled = false;
      const commentLineProvider = () => {
        providerCalled = true;
        return new Set([1]);
      };

      // Act
      const result = classifyPatchText(patch, entry, commentLineProvider);

      // Assert
      expect(providerCalled).toBe(true);
      expect(result.comments.insertions).toBe(1);
      expect(result.implementation.insertions).toBe(0);
    });

    it("should classify deletions using old side path and SHA", () => {
      // Arrange
      const patch = ["@@ -1,2 +0,0 @@", "-// old comment", "-const x = 1;"].join("\n");
      const entry = {
        oldPath: "src/value.js",
        newPath: "src/value.js",
        oldSha: "abc1234",
        newSha: "def5678",
      };
      const commentLineProvider = () => new Set([1]);

      // Act
      const result = classifyPatchText(patch, entry, commentLineProvider);

      // Assert
      expect(result.comments.deletions).toBe(1);
      expect(result.implementation.deletions).toBe(1);
    });

    it("should classify test file changes into the tests category", () => {
      // Arrange
      const patch = ["@@ -0,0 +1,1 @@", "+it('works', () => {});"].join("\n");
      const entry = {
        oldPath: null,
        newPath: "test/app.test.js",
        oldSha: "0000000",
        newSha: "abc1234",
      };

      // Act
      const result = classifyPatchText(patch, entry, () => new Set());

      // Assert
      expect(result.tests.insertions).toBe(1);
      expect(result.implementation.insertions).toBe(0);
    });

    it("should classify documentation file changes into the documentation category", () => {
      // Arrange
      const patch = ["@@ -0,0 +1,1 @@", "+# New docs"].join("\n");
      const entry = {
        oldPath: null,
        newPath: "README.md",
        oldSha: "0000000",
        newSha: "abc1234",
      };

      // Act
      const result = classifyPatchText(patch, entry, () => new Set());

      // Assert
      expect(result.documentation.insertions).toBe(1);
    });

    it("should classify configuration file changes into the configuration category", () => {
      // Arrange
      const patch = ["@@ -0,0 +1,1 @@", '+{"name": "test"}'].join("\n");
      const entry = {
        oldPath: null,
        newPath: "package.json",
        oldSha: "0000000",
        newSha: "abc1234",
      };

      // Act
      const result = classifyPatchText(patch, entry, () => new Set());

      // Assert
      expect(result.configuration.insertions).toBe(1);
    });
  });

  describe("parseCommentsByLine", () => {
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
  });

  describe("isTestPath", () => {
    it("should treat empty paths as non-test paths", () => {
      // Arrange
      const filePath = "";

      // Act
      const result = isTestPath(filePath);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("isDocPath", () => {
    it("should match markdown files", () => {
      expect(isDocPath("README.md")).toBe(true);
      expect(isDocPath("docs/guide.md")).toBe(true);
    });

    it("should match text and restructured text files", () => {
      expect(isDocPath("notes.txt")).toBe(true);
      expect(isDocPath("docs/guide.rst")).toBe(true);
      expect(isDocPath("docs/guide.adoc")).toBe(true);
    });

    it("should match bare documentation filenames", () => {
      expect(isDocPath("LICENSE")).toBe(true);
      expect(isDocPath("CHANGELOG")).toBe(true);
      expect(isDocPath("AUTHORS")).toBe(true);
      expect(isDocPath("CONTRIBUTORS")).toBe(true);
    });

    it("should not match source files", () => {
      expect(isDocPath("src/app.js")).toBe(false);
      expect(isDocPath("src/app.ts")).toBe(false);
    });

    it("should treat empty paths as non-doc paths", () => {
      expect(isDocPath("")).toBe(false);
      expect(isDocPath(null)).toBe(false);
    });
  });

  describe("isConfigPath", () => {
    it("should match config file extensions", () => {
      expect(isConfigPath("package.json")).toBe(true);
      expect(isConfigPath("config.yaml")).toBe(true);
      expect(isConfigPath("config.yml")).toBe(true);
      expect(isConfigPath("config.toml")).toBe(true);
      expect(isConfigPath(".env")).toBe(true);
    });

    it("should match any dotfile as config", () => {
      expect(isConfigPath(".editorconfig")).toBe(true);
      expect(isConfigPath(".gitignore")).toBe(true);
      expect(isConfigPath(".gitattributes")).toBe(true);
      expect(isConfigPath(".npmrc")).toBe(true);
      expect(isConfigPath(".prettierrc")).toBe(true);
      expect(isConfigPath(".dockerignore")).toBe(true);
      expect(isConfigPath(".env.local")).toBe(true);
      expect(isConfigPath(".huskyrc")).toBe(true);
      expect(isConfigPath(".gitkeep")).toBe(true);
      expect(isConfigPath("src/.eslintrc.json")).toBe(true);
    });

    it("should match files with config in the name", () => {
      expect(isConfigPath("eslint.config.js")).toBe(true);
      expect(isConfigPath("vitest.config.js")).toBe(true);
    });

    it("should not match source files", () => {
      expect(isConfigPath("src/app.js")).toBe(false);
      expect(isConfigPath("src/app.ts")).toBe(false);
    });

    it("should treat empty paths as non-config paths", () => {
      expect(isConfigPath("")).toBe(false);
      expect(isConfigPath(null)).toBe(false);
    });
  });

  describe("getCommentSyntax", () => {
    it("should return syntax for C-style languages", () => {
      const syntax = getCommentSyntax("main.go");
      expect(syntax).toEqual({ line: ["//"], block: ["/*", "*/"] });
    });

    it("should return syntax for hash-comment languages", () => {
      const syntax = getCommentSyntax("script.py");
      expect(syntax).toEqual({ line: ["#"], block: null });
    });

    it("should return syntax for HTML/XML", () => {
      const syntax = getCommentSyntax("index.html");
      expect(syntax).toEqual({ line: [], block: ["<!--", "-->"] });
    });

    it("should return syntax for CSS", () => {
      const syntax = getCommentSyntax("styles.css");
      expect(syntax).toEqual({ line: [], block: ["/*", "*/"] });
    });

    it("should return syntax for SQL", () => {
      const syntax = getCommentSyntax("query.sql");
      expect(syntax).toEqual({ line: ["--"], block: null });
    });

    it("should return syntax for PHP with multiple line prefixes", () => {
      const syntax = getCommentSyntax("index.php");
      expect(syntax).toEqual({ line: ["//", "#"], block: ["/*", "*/"] });
    });

    it("should return null for JS/TS extensions", () => {
      expect(getCommentSyntax("app.js")).toBeNull();
      expect(getCommentSyntax("app.ts")).toBeNull();
    });

    it("should return null for unsupported extensions", () => {
      expect(getCommentSyntax("data.csv")).toBeNull();
      expect(getCommentSyntax("image.png")).toBeNull();
    });

    it("should return null for empty or null paths", () => {
      expect(getCommentSyntax("")).toBeNull();
      expect(getCommentSyntax(null)).toBeNull();
    });
  });

  describe("parseCommentsByLineGeneric", () => {
    it("should detect Python hash comments", () => {
      // Arrange
      const source = "x = 1\n# this is a comment\ny = 2";
      const syntax = { line: ["#"], block: null };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2]));
    });

    it("should ignore hash inside double-quoted strings", () => {
      // Arrange
      const source = 'x = "# not a comment"\n# real comment';
      const syntax = { line: ["#"], block: null };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2]));
    });

    it("should ignore hash inside single-quoted strings", () => {
      // Arrange
      const source = "x = '# not a comment'\n# real comment";
      const syntax = { line: ["#"], block: null };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2]));
    });

    it("should detect C-style line comments", () => {
      // Arrange
      const source = "int x = 1; // inline comment\nint y = 2;";
      const syntax = { line: ["//"], block: ["/*", "*/"] };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([1]));
    });

    it("should detect C-style block comments spanning multiple lines", () => {
      // Arrange
      const source = "int x = 1;\n/* start\n  middle\n  end */\nint y = 2;";
      const syntax = { line: ["//"], block: ["/*", "*/"] };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2, 3, 4]));
    });

    it("should detect single-line block comments", () => {
      // Arrange
      const source = "int x = 1;\n/* single line block */\nint y = 2;";
      const syntax = { line: ["//"], block: ["/*", "*/"] };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2]));
    });

    it("should detect HTML block comments", () => {
      // Arrange
      const source = "<div>hello</div>\n<!-- comment -->\n<p>world</p>";
      const syntax = { line: [], block: ["<!--", "-->"] };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2]));
    });

    it("should detect multi-line HTML comments", () => {
      // Arrange
      const source = "<div>\n<!--\n  multi-line\n  comment\n-->\n</div>";
      const syntax = { line: [], block: ["<!--", "-->"] };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2, 3, 4, 5]));
    });

    it("should detect SQL double-dash comments", () => {
      // Arrange
      const source = "SELECT * FROM users;\n-- get active users\nWHERE active = 1;";
      const syntax = { line: ["--"], block: null };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2]));
    });

    it("should detect PHP comments with both // and # prefixes", () => {
      // Arrange
      const source = "$x = 1;\n// slash comment\n# hash comment\n$y = 2;";
      const syntax = { line: ["//", "#"], block: ["/*", "*/"] };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2, 3]));
    });

    it("should return empty set for source with no comments", () => {
      // Arrange
      const source = "x = 1\ny = 2\nz = 3";
      const syntax = { line: ["#"], block: null };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result.size).toBe(0);
    });

    it("should ignore block comment openers inside strings", () => {
      // Arrange
      const source = 'x = "/* not a block */"\ny = 1;';
      const syntax = { line: ["//"], block: ["/*", "*/"] };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result.size).toBe(0);
    });

    it("should handle block comment with no line comment prefixes", () => {
      // Arrange
      const source = ".class { color: red; }\n/* reset */\nbody { margin: 0; }";
      const syntax = { line: [], block: ["/*", "*/"] };

      // Act
      const result = parseCommentsByLineGeneric(source, syntax);

      // Assert
      expect(result).toEqual(new Set([2]));
    });
  });

  describe("parseCommentsByLine (dispatch)", () => {
    it("should use Babel parser for JS files", () => {
      // Arrange
      const source = "// js comment\nconst x = 1;";

      // Act
      const result = parseCommentsByLine(source, "src/app.js");

      // Assert
      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(false);
    });

    it("should use generic parser for Python files", () => {
      // Arrange
      const source = "x = 1\n# python comment\ny = 2";

      // Act
      const result = parseCommentsByLine(source, "main.py");

      // Assert
      expect(result.has(2)).toBe(true);
      expect(result.has(1)).toBe(false);
    });

    it("should use generic parser for HTML files", () => {
      // Arrange
      const source = "<div>hello</div>\n<!-- comment -->\n<p>world</p>";

      // Act
      const result = parseCommentsByLine(source, "index.html");

      // Assert
      expect(result.has(2)).toBe(true);
    });

    it("should throw for unsupported file extensions", () => {
      expect(() => parseCommentsByLine("data", "file.csv")).toThrow("No comment parser available");
    });
  });

  describe("classifyPatchText with generic comment languages", () => {
    it("should classify Python comment lines as comments", () => {
      // Arrange
      const patch = ["@@ -0,0 +1,3 @@", "+x = 1", "+# a comment", "+y = 2"].join("\n");
      const entry = {
        oldPath: null,
        newPath: "main.py",
        oldSha: "0000000",
        newSha: "abc1234",
      };
      const commentLineProvider = () => new Set([2]);

      // Act
      const result = classifyPatchText(patch, entry, commentLineProvider);

      // Assert
      expect(result.comments.insertions).toBe(1);
      expect(result.implementation.insertions).toBe(2);
    });

    it("should classify Go comment lines as comments", () => {
      // Arrange
      const patch = ["@@ -0,0 +1,2 @@", "+// go comment", "+x := 1"].join("\n");
      const entry = {
        oldPath: null,
        newPath: "main.go",
        oldSha: "0000000",
        newSha: "abc1234",
      };
      const commentLineProvider = () => new Set([1]);

      // Act
      const result = classifyPatchText(patch, entry, commentLineProvider);

      // Assert
      expect(result.comments.insertions).toBe(1);
      expect(result.implementation.insertions).toBe(1);
    });

    it("should classify HTML comment lines as comments", () => {
      // Arrange
      const patch = ["@@ -0,0 +1,2 @@", "+<!-- html comment -->", "+<div>hi</div>"].join("\n");
      const entry = {
        oldPath: null,
        newPath: "index.html",
        oldSha: "0000000",
        newSha: "abc1234",
      };
      const commentLineProvider = () => new Set([1]);

      // Act
      const result = classifyPatchText(patch, entry, commentLineProvider);

      // Assert
      expect(result.comments.insertions).toBe(1);
      expect(result.implementation.insertions).toBe(1);
    });

    it("should fall through to implementation for unsupported extensions", () => {
      // Arrange
      const patch = ["@@ -0,0 +1,2 @@", "+some data", "+more data"].join("\n");
      const entry = {
        oldPath: null,
        newPath: "data.csv",
        oldSha: "0000000",
        newSha: "abc1234",
      };

      // Act
      const result = classifyPatchText(patch, entry, () => new Set());

      // Assert
      expect(result.implementation.insertions).toBe(2);
      expect(result.comments.insertions).toBe(0);
    });
  });
});
