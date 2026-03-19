import { describe, it, expect } from "vitest";

import {
  classifyPatchText,
  isTestPath,
  parseCommentsByLine,
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
});
