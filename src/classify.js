import * as babelParser from "@babel/parser";
import { zeroSha, parseHunkHeader } from "./git-parse.js";

/**
 * @typedef {import('./git-parse.js').RawDiffEntry} RawDiffEntry
 */

/**
 * @typedef {Object} LineCounts
 * @property {number} insertions - Number of inserted lines.
 * @property {number} deletions - Number of deleted lines.
 */

/**
 * @typedef {Object} CategoryTotals
 * @property {LineCounts} implementation - Implementation line counts.
 * @property {LineCounts} tests - Test line counts.
 * @property {LineCounts} comments - Comment line counts.
 * @property {LineCounts} documentation - Documentation line counts.
 * @property {LineCounts} configuration - Configuration line counts.
 */

/**
 * @typedef {Object} Reconciliation
 * @property {boolean} pass - Whether computed totals match authoritative totals.
 * @property {LineCounts} expected - Git shortstat totals.
 * @property {LineCounts} computed - Category rollup totals.
 */

/**
 * @callback CommentLineProvider
 * @param {string} sha - Blob SHA.
 * @param {string} path - File path associated with the blob.
 * @returns {Set<number>} Set of line numbers identified as comments.
 */

/**
 * Determines whether a path should be categorized as a test file.
 *
 * @param {string|null|undefined} path - File path to classify.
 * @returns {boolean} True when the path matches test conventions.
 */
function isTestPath(path) {
  const lower = (path || "").toLowerCase();
  if (!lower) {
    return false;
  }
  const hasTestSegment = /(^|\/)(test|tests|__tests__)(\/|$)/.test(lower);
  const hasTestFileName = /\.(test|spec)\.[^/]+$/.test(lower);
  return hasTestSegment || hasTestFileName;
}

/**
 * Determines whether a path belongs to a JS or TS family file extension.
 *
 * @param {string|null|undefined} path - File path to classify.
 * @returns {boolean} True for JS or TS family extensions.
 */
function isJsTsPath(path) {
  return /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i.test(path || "");
}

/**
 * Determines whether a path should be categorized as documentation.
 *
 * @param {string|null|undefined} path - File path to classify.
 * @returns {boolean} True when the path matches documentation conventions.
 */
function isDocPath(path) {
  const lower = (path || "").toLowerCase();
  if (!lower) {
    return false;
  }
  if (/\.(md|txt|rst|adoc)$/i.test(lower)) {
    return true;
  }
  const basename = lower.split("/").pop() || "";
  return /^(license|licence|changelog|changes|authors|contributors|readme)$/i.test(basename);
}

/**
 * Determines whether a path should be categorized as configuration.
 *
 * @param {string|null|undefined} path - File path to classify.
 * @returns {boolean} True when the path matches configuration conventions.
 */
function isConfigPath(path) {
  const lower = (path || "").toLowerCase();
  if (!lower) {
    return false;
  }
  if (/\.(json|jsonc|yaml|yml|toml|ini|env|properties)$/i.test(lower)) {
    return true;
  }
  const basename = lower.split("/").pop() || "";
  if (
    /^\.(editorconfig|gitignore|gitattributes|npmrc|nvmrc|prettierrc|eslintrc|stylelintrc|babelrc)$/i.test(
      basename,
    )
  ) {
    return true;
  }
  return /\.(config|rc)\.[^/]+$|config\.[^/]+$/i.test(basename);
}

/**
 * Parses source text and returns the set of line numbers that contain comments.
 *
 * @param {string} sourceText - File content to parse.
 * @param {string} filePath - Path used to infer parser plugins.
 * @returns {Set<number>} Set of comment line numbers.
 * @throws {Error} When the source cannot be parsed by supported plugin sets.
 */
function parseCommentsByLine(sourceText, filePath) {
  const commentsByLine = new Set();

  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const isTs = ext === "ts" || ext === "tsx" || ext === "mts" || ext === "cts";
  const isJsxLike = ext === "jsx" || ext === "tsx";

  const pluginSets = [];
  if (isTs && isJsxLike) {
    pluginSets.push(["typescript", "jsx"]);
    pluginSets.push(["typescript"]);
  } else if (isTs) {
    pluginSets.push(["typescript"]);
    pluginSets.push(["typescript", "jsx"]);
  } else if (isJsxLike) {
    pluginSets.push(["jsx"]);
    pluginSets.push([]);
  } else {
    pluginSets.push([]);
    pluginSets.push(["jsx"]);
  }

  let ast = null;
  let lastError = null;

  for (const plugins of pluginSets) {
    try {
      ast = babelParser.parse(sourceText, {
        sourceType: "unambiguous",
        plugins,
        errorRecovery: true,
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!ast) {
    const reason = lastError ? lastError.message : "unknown parser error";
    throw new Error(`Unable to parse ${filePath} for comments: ${reason}`);
  }

  for (const comment of ast.comments || []) {
    /* istanbul ignore next -- Babel comment nodes normally include locations; guard protects parser edge cases */
    if (!comment.loc) {
      continue;
    }
    for (let line = comment.loc.start.line; line <= comment.loc.end.line; line += 1) {
      commentsByLine.add(line);
    }
  }

  return commentsByLine;
}

/**
 * Classifies one changed line into implementation, tests, or comments.
 *
 * @param {'old'|'new'} side - Side of the diff line being classified.
 * @param {number} lineNumber - Line number on the selected side.
 * @param {RawDiffEntry} entry - Raw diff entry for the file.
 * @param {CommentLineProvider} commentLineProvider - Provider for comment line sets.
 * @returns {'implementation'|'tests'|'comments'|'documentation'|'configuration'} Line classification category.
 */
function classifyLine(side, lineNumber, entry, commentLineProvider) {
  const sidePath = side === "old" ? entry.oldPath : entry.newPath;
  if (!sidePath) {
    return "implementation";
  }

  if (isTestPath(sidePath)) {
    return "tests";
  }

  if (isDocPath(sidePath)) {
    return "documentation";
  }

  if (isConfigPath(sidePath)) {
    return "configuration";
  }

  if (isJsTsPath(sidePath)) {
    const sideSha = side === "old" ? entry.oldSha : entry.newSha;
    if (!zeroSha(sideSha)) {
      const commentLines = commentLineProvider(sideSha, sidePath);
      if (commentLines.has(lineNumber)) {
        return "comments";
      }
    }
  }

  return "implementation";
}

/**
 * Classifies all changed lines in a patch into category totals.
 *
 * @param {string} patchText - Unified diff patch text.
 * @param {RawDiffEntry} entry - Raw diff entry associated with the patch.
 * @param {CommentLineProvider} commentLineProvider - Provider for comment line sets.
 * @returns {CategoryTotals} Per-category insertion and deletion counts.
 */
function classifyPatchText(patchText, entry, commentLineProvider) {
  const result = {
    implementation: { insertions: 0, deletions: 0 },
    tests: { insertions: 0, deletions: 0 },
    comments: { insertions: 0, deletions: 0 },
    documentation: { insertions: 0, deletions: 0 },
    configuration: { insertions: 0, deletions: 0 },
  };

  if (!patchText) {
    return result;
  }

  const lines = patchText.split("\n");
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunk = parseHunkHeader(line);
    if (hunk) {
      inHunk = true;
      oldLine = hunk.oldLine;
      newLine = hunk.newLine;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const category = classifyLine("new", newLine, entry, commentLineProvider);
      result[category].insertions += 1;
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      const category = classifyLine("old", oldLine, entry, commentLineProvider);
      result[category].deletions += 1;
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }

  return result;
}

/**
 * Adds delta category counts into a target accumulator.
 *
 * @param {CategoryTotals} target - Mutable totals accumulator.
 * @param {CategoryTotals} delta - Increment values to add.
 * @returns {void}
 */
function addCategoryTotals(target, delta) {
  for (const category of [
    "implementation",
    "tests",
    "comments",
    "documentation",
    "configuration",
  ]) {
    target[category].insertions += delta[category].insertions;
    target[category].deletions += delta[category].deletions;
  }
}

/**
 * Reconciles category totals against authoritative git insertion and deletion totals.
 *
 * @param {LineCounts} total - Authoritative insertions and deletions.
 * @param {CategoryTotals} categories - Category totals to reconcile.
 * @returns {Reconciliation} Reconciliation result.
 */
function reconcileTotals(total, categories) {
  let computedInsertions = 0;
  let computedDeletions = 0;
  for (const category of [
    "implementation",
    "tests",
    "comments",
    "documentation",
    "configuration",
  ]) {
    computedInsertions += categories[category].insertions;
    computedDeletions += categories[category].deletions;
  }

  const pass = computedInsertions === total.insertions && computedDeletions === total.deletions;

  return {
    pass,
    expected: {
      insertions: total.insertions,
      deletions: total.deletions,
    },
    computed: {
      insertions: computedInsertions,
      deletions: computedDeletions,
    },
  };
}

/**
 * Creates an empty category totals object.
 *
 * @returns {CategoryTotals} Zeroed category totals.
 */
function createEmptyCategories() {
  return {
    implementation: { insertions: 0, deletions: 0 },
    tests: { insertions: 0, deletions: 0 },
    comments: { insertions: 0, deletions: 0 },
    documentation: { insertions: 0, deletions: 0 },
    configuration: { insertions: 0, deletions: 0 },
  };
}

export {
  isTestPath,
  isJsTsPath,
  isDocPath,
  isConfigPath,
  parseCommentsByLine,
  classifyPatchText,
  addCategoryTotals,
  reconcileTotals,
  createEmptyCategories,
};
