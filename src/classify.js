import * as babelParser from "@babel/parser";
import { parseHunkHeader } from "./git-parse.js";

/**
 * @typedef {import('./git-parse.js').RawDiffEntry} RawDiffEntry
 */

/**
 * @typedef {'implementation'|'tests'|'comments'|'documentation'|'configuration'} Category
 */

/** @type {Category[]} */
const CATEGORY_NAMES = ["implementation", "tests", "comments", "documentation", "configuration"];

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
  if (basename.startsWith(".")) {
    return true;
  }
  return /\.(config|rc)\.[^/]+$|config\.[^/]+$/i.test(basename);
}

/**
 * @typedef {Object} CommentSyntax
 * @property {string[]} line - Line comment prefixes (e.g. ['//'] or ['#']).
 * @property {[string, string]|null} block - Block comment open/close pair, or null.
 */

/** @type {Map<string, CommentSyntax>} */
const COMMENT_SYNTAX = new Map([
  // C-style: line + block
  ...["c", "cpp", "h", "hpp", "cs", "go", "java", "rs", "swift", "kt", "scala", "groovy"].map(
    (ext) => [ext, { line: ["//"], block: ["/*", "*/"] }],
  ),

  // Hash line only
  ...["py", "sh", "bash", "rb", "pl", "r"].map((ext) => [ext, { line: ["#"], block: null }]),

  // HTML/XML block only
  ...["html", "htm", "xml", "svg", "vue"].map((ext) => [ext, { line: [], block: ["<!--", "-->"] }]),

  // CSS block only
  ...["css", "scss", "less"].map((ext) => [ext, { line: [], block: ["/*", "*/"] }]),

  // Double-dash line
  ...["sql", "lua", "hs"].map((ext) => [ext, { line: ["--"], block: null }]),

  // PHP: multiple line prefixes + block
  ["php", { line: ["//", "#"], block: ["/*", "*/"] }],
]);

/**
 * Returns the comment syntax rules for a file path, or null if unsupported.
 *
 * @param {string|null|undefined} filePath - File path to look up.
 * @returns {CommentSyntax|null} Syntax rules, or null when the extension is not recognized.
 *
 * @example
 * getCommentSyntax('main.py')   // { line: ['#'], block: null }
 * getCommentSyntax('app.js')    // null (JS/TS uses Babel parser)
 * getCommentSyntax('data.csv')  // null
 */
function getCommentSyntax(filePath) {
  if (!filePath) {
    return null;
  }
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  return COMMENT_SYNTAX.get(ext) || null;
}

/**
 * Checks whether a character is inside an active string literal.
 *
 * Tracks single-quote, double-quote, and backtick boundaries with backslash
 * escape awareness. Returns updated state.
 *
 * @param {string} ch - Current character.
 * @param {string} prev - Previous character.
 * @param {string} stringChar - Active quote character, or empty string.
 * @returns {string} Updated stringChar state.
 */
function updateStringState(ch, prev, stringChar) {
  if (stringChar) {
    if (ch === stringChar && prev !== "\\") {
      return "";
    }
    return stringChar;
  }
  if ((ch === '"' || ch === "'" || ch === "`") && prev !== "\\") {
    return ch;
  }
  return "";
}

/**
 * Finds the position of a line comment prefix outside of string literals.
 *
 * @param {string} line - Source line to scan.
 * @param {string[]} prefixes - Line comment prefixes to search for.
 * @returns {number} Index of the first unquoted prefix, or -1.
 */
function findLineComment(line, prefixes) {
  if (prefixes.length === 0) {
    return -1;
  }
  let stringChar = "";
  for (let i = 0; i < line.length; i += 1) {
    stringChar = updateStringState(line[i], i > 0 ? line[i - 1] : "", stringChar);
    if (stringChar) {
      continue;
    }
    for (const prefix of prefixes) {
      if (line.startsWith(prefix, i)) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Parses source text using regex-based comment syntax rules and returns the
 * set of 1-indexed line numbers that contain comments.
 *
 * @param {string} sourceText - File content to parse.
 * @param {CommentSyntax} syntax - Comment syntax rules for the language.
 * @returns {Set<number>} Set of comment line numbers.
 *
 * @example
 * const syntax = { line: ['#'], block: null };
 * parseCommentsByLineGeneric('x = 1\n# note\ny = 2', syntax)
 * // => Set {2}
 */
function parseCommentsByLineGeneric(sourceText, syntax) {
  const commentsByLine = new Set();
  const lines = sourceText.split("\n");
  let inBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    const lineNumber = i + 1;

    if (inBlock) {
      commentsByLine.add(lineNumber);
      if (syntax.block && lineText.includes(syntax.block[1])) {
        inBlock = false;
      }
      continue;
    }

    if (syntax.block) {
      let stringChar = "";
      let foundBlock = false;
      for (let j = 0; j < lineText.length; j += 1) {
        stringChar = updateStringState(lineText[j], j > 0 ? lineText[j - 1] : "", stringChar);
        if (stringChar) {
          continue;
        }
        if (lineText.startsWith(syntax.block[0], j)) {
          commentsByLine.add(lineNumber);
          const afterOpen = j + syntax.block[0].length;
          const rest = lineText.slice(afterOpen);
          if (!rest.includes(syntax.block[1])) {
            inBlock = true;
          }
          foundBlock = true;
          break;
        }
      }
      if (foundBlock) {
        continue;
      }
    }

    if (findLineComment(lineText, syntax.line) !== -1) {
      commentsByLine.add(lineNumber);
    }
  }

  return commentsByLine;
}

/**
 * Parses JS/TS source text using Babel and returns comment line numbers.
 *
 * @param {string} sourceText - File content to parse.
 * @param {string} filePath - Path used to infer parser plugins.
 * @returns {Set<number>} Set of comment line numbers.
 * @throws {Error} When the source cannot be parsed by supported plugin sets.
 */
function parseCommentsByLineBabel(sourceText, filePath) {
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
 * Parses source text and returns the set of line numbers that contain comments.
 *
 * Dispatches to Babel for JS/TS files and to a regex-based scanner for other
 * supported languages.
 *
 * @param {string} sourceText - File content to parse.
 * @param {string} filePath - Path used to select the parsing strategy.
 * @returns {Set<number>} Set of comment line numbers.
 * @throws {Error} When the file type is unsupported or parsing fails.
 *
 * @example
 * parseCommentsByLine('// hello', 'src/app.js')  // Babel path
 * parseCommentsByLine('# hello', 'main.py')      // Generic path
 */
function parseCommentsByLine(sourceText, filePath) {
  if (isJsTsPath(filePath)) {
    return parseCommentsByLineBabel(sourceText, filePath);
  }

  const syntax = getCommentSyntax(filePath);
  if (syntax) {
    return parseCommentsByLineGeneric(sourceText, syntax);
  }

  throw new Error(`No comment parser available for ${filePath}`);
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

  if (isJsTsPath(sidePath) || getCommentSyntax(sidePath)) {
    const sideSha = side === "old" ? entry.oldSha : entry.newSha;
    const commentLines = commentLineProvider(sideSha, sidePath);
    if (commentLines.has(lineNumber)) {
      return "comments";
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
  for (const category of CATEGORY_NAMES) {
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
  for (const category of CATEGORY_NAMES) {
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
  CATEGORY_NAMES,
  isTestPath,
  isJsTsPath,
  isDocPath,
  isConfigPath,
  getCommentSyntax,
  parseCommentsByLine,
  parseCommentsByLineGeneric,
  classifyPatchText,
  addCategoryTotals,
  reconcileTotals,
  createEmptyCategories,
};
