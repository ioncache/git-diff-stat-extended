import { spawnSync } from "node:child_process";
import picomatch from "picomatch";
import * as babelParser from "@babel/parser";

/**
 * @typedef {Object} RunGitOptions
 * @property {string} [cwd] - Working directory used to execute git.
 * @property {boolean} [allowFailure=false] - When true, non-zero git exits are returned instead of thrown.
 */

/**
 * @typedef {Object} GitResult
 * @property {number} status - Process exit code.
 * @property {string} stdout - Process standard output.
 * @property {string} stderr - Process standard error.
 */

/**
 * @typedef {Object} RawDiffEntry
 * @property {string} oldMode - Source file mode in octal form.
 * @property {string} newMode - Destination file mode in octal form.
 * @property {string} oldSha - Source blob SHA.
 * @property {string} newSha - Destination blob SHA.
 * @property {string} status - Single-letter diff status.
 * @property {string} statusCode - Full diff status code including score.
 * @property {string|null} oldPath - Source path when present.
 * @property {string|null} newPath - Destination path when present.
 * @property {string} displayPath - Primary path used for display and filtering.
 */

/**
 * @typedef {Object} Shortstat
 * @property {number} filesChanged - Number of files changed.
 * @property {number} insertions - Number of inserted lines.
 * @property {number} deletions - Number of deleted lines.
 * @property {string} raw - Raw shortstat output text.
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
 */

/**
 * @typedef {Object} Reconciliation
 * @property {boolean} pass - Whether computed totals match authoritative totals.
 * @property {LineCounts} expected - Git shortstat totals.
 * @property {LineCounts} computed - Category rollup totals.
 */

/**
 * @typedef {Object} FilterSet
 * @property {string[]} include - Include patterns.
 * @property {string[]} exclude - Exclude patterns.
 */

/**
 * @typedef {Object} ReportTotals
 * @property {number} filesChanged - Number of files changed.
 * @property {number} insertions - Number of inserted lines.
 * @property {number} deletions - Number of deleted lines.
 */

/**
 * @typedef {Object} HunkHeader
 * @property {number} oldLine - Starting old-side line number.
 * @property {number} newLine - Starting new-side line number.
 */

/**
 * @typedef {Object} GenerateStatsOptions
 * @property {string} [base] - Base ref used with head when range is not provided.
 * @property {string} [head] - Head ref used with base when range is not provided.
 * @property {string} [range] - Explicit git revset.
 * @property {string|string[]} [include] - Include glob pattern or list of patterns.
 * @property {string|string[]} [exclude] - Exclude glob pattern or list of patterns.
 * @property {string} [cwd] - Working directory used to execute git.
 * @property {boolean} [verbose=false] - Enables warning output for recoverable parse failures.
 */

/**
 * @typedef {Object} SelectedFile
 * @property {string} status - Git raw diff status code.
 * @property {string|null} oldPath - Source path.
 * @property {string|null} newPath - Destination path.
 * @property {string} path - Primary display path.
 */

/**
 * @typedef {Object} GdsxReport
 * @property {string} range - Effective comparison range.
 * @property {string[]} rangeArgs - Git range arguments used for diff commands.
 * @property {FilterSet} filters - Normalized include and exclude patterns.
 * @property {ReportTotals} total - Authoritative totals from git shortstat.
 * @property {CategoryTotals} categories - Categorized implementation, test, and comment totals.
 * @property {Reconciliation} reconciliation - Reconciliation status and totals.
 * @property {string} shortstatLine - Human-readable shortstat line.
 * @property {SelectedFile[]} selectedFiles - Selected files used for stat computation.
 */

/**
 * @callback CommentLineProvider
 * @param {string} sha - Blob SHA.
 * @param {string} path - File path associated with the blob.
 * @returns {Set<number>} Set of line numbers identified as comments.
 */

/**
 * Runs a git command and returns process output.
 *
 * @param {string[]} args - Git arguments to execute.
 * @param {RunGitOptions} [options={}] - Execution options.
 * @returns {GitResult} Git process result.
 * @throws {Error} When the git process cannot be started.
 * @throws {Error} When git exits non-zero and allowFailure is false.
 *
 * @example
 * const result = runGit(['rev-parse', 'HEAD'], { cwd: '/repo' });
 * console.log(result.stdout.trim());
 */
function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      LC_ALL: "C",
      LANG: "C",
    },
  });

  /* istanbul ignore next -- child_process transport errors are runtime-environment failures, not business logic */
  if (result.error) {
    throw new Error(`Failed to run git: ${result.error.message}`);
  }

  /* istanbul ignore next -- exercised through real git operations; explicit failure path is delegated to git itself */
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = (result.stderr || "").trim();
    const suffix = stderr ? `\n${stderr}` : "";
    throw new Error(`git ${args.join(" ")} failed with exit code ${result.status}.${suffix}`);
  }

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

/**
 * Checks whether a SHA is absent or represents git's all-zero sentinel.
 *
 * @param {string|null|undefined} sha - Candidate SHA string.
 * @returns {boolean} True when the SHA is empty or all zeros.
 */
function zeroSha(sha) {
  return !sha || /^0+$/.test(sha);
}

/**
 * Parses NUL-delimited git raw diff output into structured entries.
 *
 * @param {string} rawText - Raw text returned by `git diff --raw -z`.
 * @returns {RawDiffEntry[]} Parsed raw diff entries.
 * @throws {Error} When a metadata token does not match git raw diff format.
 */
function parseRawDiffZ(rawText) {
  if (!rawText) {
    return [];
  }

  const tokens = rawText.split("\0");
  if (tokens[tokens.length - 1] === "") {
    tokens.pop();
  }

  const entries = [];
  let i = 0;

  while (i < tokens.length) {
    const meta = tokens[i++];
    if (!meta) {
      continue;
    }

    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z][0-9]*)$/.exec(meta);
    if (!match) {
      throw new Error(`Unable to parse git raw diff metadata token: ${meta}`);
    }

    const statusCode = match[5];
    const status = statusCode[0];

    let oldPath = null;
    let newPath = null;

    if (status === "R" || status === "C") {
      oldPath = tokens[i++] || null;
      newPath = tokens[i++] || null;
    } else {
      const path = tokens[i++] || null;
      if (status === "A") {
        newPath = path;
      } else if (status === "D") {
        oldPath = path;
      } else {
        oldPath = path;
        newPath = path;
      }
    }

    entries.push({
      oldMode: match[1],
      newMode: match[2],
      oldSha: match[3],
      newSha: match[4],
      status,
      statusCode,
      oldPath,
      newPath,
      displayPath: newPath || oldPath || "",
    });
  }

  return entries;
}

/**
 * Parses git shortstat output into numeric totals.
 *
 * @param {string} shortstatText - Raw shortstat text.
 * @returns {Shortstat} Parsed shortstat fields.
 */
function parseShortstat(shortstatText) {
  const text = (shortstatText || "").trim();
  const parsed = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    raw: text,
  };

  if (!text) {
    return parsed;
  }

  const filesMatch = text.match(/(\d+)\s+files?\s+changed/);
  const insertionsMatch = text.match(/(\d+)\s+insertions?\(\+\)/);
  const deletionsMatch = text.match(/(\d+)\s+deletions?\(-\)/);

  if (filesMatch) {
    parsed.filesChanged = Number(filesMatch[1]);
  }
  if (insertionsMatch) {
    parsed.insertions = Number(insertionsMatch[1]);
  }
  if (deletionsMatch) {
    parsed.deletions = Number(deletionsMatch[1]);
  }

  return parsed;
}

/**
 * Formats a shortstat-style summary line.
 *
 * @param {number} filesChanged - Number of changed files.
 * @param {number} insertions - Number of inserted lines.
 * @param {number} deletions - Number of deleted lines.
 * @returns {string} Formatted shortstat summary.
 */
function formatShortstatLine(filesChanged, insertions, deletions) {
  const filesWord = filesChanged === 1 ? "file" : "files";
  const insertionsWord = insertions === 1 ? "insertion" : "insertions";
  const deletionsWord = deletions === 1 ? "deletion" : "deletions";
  return `${filesChanged} ${filesWord} changed, ${insertions} ${insertionsWord}(+), ${deletions} ${deletionsWord}(-)`;
}

/**
 * Normalizes CLI include or exclude inputs into a flat string list.
 *
 * @param {string|string[]|undefined} values - Raw pattern input.
 * @returns {string[]} Normalized non-empty patterns.
 */
function normalizePatterns(values) {
  if (!values) {
    return [];
  }
  if (Array.isArray(values)) {
    return values.filter(Boolean);
  }
  return [values].filter(Boolean);
}

/**
 * Compiles glob patterns into matcher functions.
 *
 * @param {string[]} patterns - Glob patterns to compile.
 * @returns {((path: string) => boolean)[]} Path matcher functions.
 */
function buildMatchers(patterns) {
  return patterns.map((pattern) => picomatch(pattern, { dot: true }));
}

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
 * Applies include and exclude matchers to a candidate path.
 *
 * @param {string|null|undefined} path - Candidate file path.
 * @param {((path: string) => boolean)[]} includeMatchers - Include matchers.
 * @param {((path: string) => boolean)[]} excludeMatchers - Exclude matchers.
 * @returns {boolean} True when the path passes filtering.
 */
function pathSelected(path, includeMatchers, excludeMatchers) {
  /* istanbul ignore next -- parser guarantees a path for selected entries; this is a defensive null guard */
  if (!path) {
    return false;
  }

  if (includeMatchers.length > 0 && !includeMatchers.some((matcher) => matcher(path))) {
    return false;
  }

  if (excludeMatchers.some((matcher) => matcher(path))) {
    return false;
  }

  return true;
}

/**
 * Determines whether a raw diff entry should be included in reporting.
 *
 * @param {RawDiffEntry} entry - Raw diff entry to evaluate.
 * @param {((path: string) => boolean)[]} includeMatchers - Include matchers.
 * @param {((path: string) => boolean)[]} excludeMatchers - Exclude matchers.
 * @returns {boolean} True when the entry is selected.
 */
function selectEntry(entry, includeMatchers, excludeMatchers) {
  const candidate = entry.displayPath || entry.newPath || entry.oldPath;
  return pathSelected(candidate, includeMatchers, excludeMatchers);
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
 * Parses a unified diff hunk header and extracts starting line numbers.
 *
 * @param {string} line - Diff line to parse.
 * @returns {HunkHeader|null} Parsed hunk coordinates or null.
 */
function parseHunkHeader(line) {
  const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
  if (!match) {
    return null;
  }
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
  };
}

/**
 * Classifies one changed line into implementation, tests, or comments.
 *
 * @param {'old'|'new'} side - Side of the diff line being classified.
 * @param {number} lineNumber - Line number on the selected side.
 * @param {RawDiffEntry} entry - Raw diff entry for the file.
 * @param {CommentLineProvider} commentLineProvider - Provider for comment line sets.
 * @returns {'implementation'|'tests'|'comments'} Line classification category.
 */
function classifyLine(side, lineNumber, entry, commentLineProvider) {
  const sidePath = side === "old" ? entry.oldPath : entry.newPath;
  if (!sidePath) {
    return "implementation";
  }

  if (isTestPath(sidePath)) {
    return "tests";
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
  target.implementation.insertions += delta.implementation.insertions;
  target.implementation.deletions += delta.implementation.deletions;
  target.tests.insertions += delta.tests.insertions;
  target.tests.deletions += delta.tests.deletions;
  target.comments.insertions += delta.comments.insertions;
  target.comments.deletions += delta.comments.deletions;
}

/**
 * Reconciles category totals against authoritative git insertion and deletion totals.
 *
 * @param {LineCounts} total - Authoritative insertions and deletions.
 * @param {CategoryTotals} categories - Category totals to reconcile.
 * @returns {Reconciliation} Reconciliation result.
 */
function reconcileTotals(total, categories) {
  const computedInsertions =
    categories.implementation.insertions +
    categories.tests.insertions +
    categories.comments.insertions;

  const computedDeletions =
    categories.implementation.deletions +
    categories.tests.deletions +
    categories.comments.deletions;

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
 * Builds git range arguments from explicit range or base and head refs.
 *
 * @param {GenerateStatsOptions} input - User-provided range options.
 * @returns {string[]} Git range arguments for diff commands.
 */
function buildRangeArgs(input) {
  if (input.range) {
    return [input.range];
  }
  return [input.base || "HEAD~1", input.head || "HEAD"];
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
  };
}

/**
 * Generates extended diff stats and reconciliation details for a git range.
 *
 * @param {GenerateStatsOptions} [options={}] - Report generation options.
 * @returns {GdsxReport} Extended stats report.
 * @throws {Error} When required git commands fail.
 * @throws {Error} When raw diff output cannot be parsed.
 *
 * @example
 * const report = generateStats({ base: 'main', head: 'HEAD' });
 * console.log(report.reconciliation.pass);
 */
function generateStats(options = {}) {
  const includePatterns = normalizePatterns(options.include);
  const excludePatterns = normalizePatterns(options.exclude);

  const includeMatchers = buildMatchers(includePatterns);
  const excludeMatchers = buildMatchers(excludePatterns);
  const cwd = options.cwd || process.cwd();
  const hasExplicitRange = Boolean(options.range || options.base || options.head);
  const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

  let rangeArgs = buildRangeArgs(options);
  let effectiveRange = options.range || `${options.base || "HEAD~1"}..${options.head || "HEAD"}`;

  if (!hasExplicitRange) {
    const hasParentCommit = runGit(["rev-parse", "--verify", "--quiet", "HEAD~1"], {
      cwd,
      allowFailure: true,
    });

    if (hasParentCommit.status !== 0) {
      const headRef = options.head || "HEAD";
      rangeArgs = [EMPTY_TREE_SHA, headRef];
      effectiveRange = `${EMPTY_TREE_SHA}..${headRef}`;
    }
  }

  const rawArgs = ["diff", "--raw", "-z", "--find-renames", "--no-ext-diff", ...rangeArgs];
  const rawResult = runGit(rawArgs, { cwd });
  const rawEntries = parseRawDiffZ(rawResult.stdout);

  const selectedEntries = rawEntries.filter((entry) =>
    selectEntry(entry, includeMatchers, excludeMatchers),
  );
  const categories = createEmptyCategories();

  let shortstat = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    raw: "",
  };

  if (selectedEntries.length > 0) {
    const pathspecSet = new Set();
    for (const entry of selectedEntries) {
      if (entry.status === "R" || entry.status === "C") {
        if (entry.oldPath) {
          pathspecSet.add(`:(literal)${entry.oldPath}`);
        }
        if (entry.newPath) {
          pathspecSet.add(`:(literal)${entry.newPath}`);
        }
      } else {
        const p = entry.displayPath || entry.newPath || entry.oldPath;
        if (p) {
          pathspecSet.add(`:(literal)${p}`);
        }
      }
    }

    const shortstatArgs = [
      "diff",
      "--shortstat",
      "--find-renames",
      "--no-ext-diff",
      ...rangeArgs,
      "--",
      ...pathspecSet,
    ];
    const shortstatResult = runGit(shortstatArgs, { cwd });
    shortstat = parseShortstat(shortstatResult.stdout);

    const commentLineCache = new Map();
    const blobTextCache = new Map();

    /**
     * Loads blob text for a given SHA using git cat-file.
     *
     * @param {string} sha - Blob SHA to load.
     * @returns {string|null} Blob text when available, otherwise null.
     * @throws {Error} When git process execution fails.
     */
    function getBlobText(sha) {
      /* istanbul ignore next -- cache-hit path depends on repeated blob lookups with identical sha/path */
      if (blobTextCache.has(sha)) {
        return blobTextCache.get(sha);
      }

      const result = runGit(["cat-file", "-p", sha], {
        cwd,
        allowFailure: true,
      });
      const text = result.status === 0 ? result.stdout : null;
      blobTextCache.set(sha, text);
      return text;
    }

    /**
     * Resolves comment line numbers for a blob and path with caching.
     *
     * @param {string} sha - Blob SHA.
     * @param {string} path - File path used for parser plugin selection.
     * @returns {Set<number>} Comment line numbers for the requested blob.
     */
    function getCommentLines(sha, path) {
      const cacheKey = `${sha}::${path}`;
      if (commentLineCache.has(cacheKey)) {
        return commentLineCache.get(cacheKey);
      }

      const sourceText = getBlobText(sha);
      let commentLines = new Set();
      if (sourceText !== null) {
        try {
          commentLines = parseCommentsByLine(sourceText, path);
        } catch (error) {
          if (options.verbose) {
            const message = error && error.message ? error.message : String(error);
            process.stderr.write(`warning: ${message}\n`);
          }
          commentLines = new Set();
        }
      }

      commentLineCache.set(cacheKey, commentLines);
      return commentLines;
    }

    for (const entry of selectedEntries) {
      const diffPath = entry.displayPath || entry.newPath || entry.oldPath;
      /* istanbul ignore next -- raw diff parser provides at least one path; retained as a defensive safety check */
      if (!diffPath) {
        continue;
      }

      const patchPathspecs = [];
      if ((entry.status === "R" || entry.status === "C") && entry.oldPath && entry.newPath) {
        patchPathspecs.push(`:(literal)${entry.oldPath}`);
        patchPathspecs.push(`:(literal)${entry.newPath}`);
      } else {
        patchPathspecs.push(`:(literal)${diffPath}`);
      }

      const patchArgs = [
        "diff",
        "--no-color",
        "--unified=0",
        "--find-renames",
        "--no-ext-diff",
        ...rangeArgs,
        "--",
        ...patchPathspecs,
      ];

      const patchResult = runGit(patchArgs, { cwd });
      const delta = classifyPatchText(patchResult.stdout, entry, getCommentLines);
      addCategoryTotals(categories, delta);
    }
  }

  const total = {
    filesChanged: shortstat.filesChanged,
    insertions: shortstat.insertions,
    deletions: shortstat.deletions,
  };

  const reconciliation = reconcileTotals(total, categories);
  const shortstatLine = formatShortstatLine(total.filesChanged, total.insertions, total.deletions);

  return {
    range: effectiveRange,
    rangeArgs,
    filters: {
      include: includePatterns,
      exclude: excludePatterns,
    },
    total,
    categories,
    reconciliation,
    shortstatLine,
    selectedFiles: selectedEntries.map((entry) => ({
      status: entry.statusCode,
      oldPath: entry.oldPath,
      newPath: entry.newPath,
      path: entry.displayPath,
    })),
  };
}

export {
  generateStats,
  parseRawDiffZ,
  parseShortstat,
  formatShortstatLine,
  isTestPath,
  isJsTsPath,
  parseCommentsByLine,
  classifyPatchText,
  reconcileTotals,
  buildRangeArgs,
};
