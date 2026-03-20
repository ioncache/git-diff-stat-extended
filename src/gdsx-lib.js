import picomatch from 'picomatch';
import {
  runGit,
  parseRawDiffZ,
  parseShortstat,
  formatShortstatLine,
  buildRangeArgs,
} from './git-parse.js';
import {
  parseCommentsByLine,
  classifyPatchText,
  addCategoryTotals,
  reconcileTotals,
  createEmptyCategories,
} from './classify.js';

/**
 * @typedef {import('./git-parse.js').RawDiffEntry} RawDiffEntry
 * @typedef {import('./classify.js').LineCounts} LineCounts
 * @typedef {import('./classify.js').CategoryTotals} CategoryTotals
 * @typedef {import('./classify.js').Reconciliation} Reconciliation
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
 * @typedef {Object} FileDetail
 * @property {string} path - Display path for the file.
 * @property {CategoryTotals} categories - Per-file category breakdown.
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
 * @property {FileDetail[]} fileDetails - Per-file category breakdowns.
 */

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
  const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

  let rangeArgs = buildRangeArgs(options);
  let effectiveRange = options.range || `${options.base || 'HEAD~1'}..${options.head || 'HEAD'}`;

  if (!hasExplicitRange) {
    const hasParentCommit = runGit(['rev-parse', '--verify', '--quiet', 'HEAD~1'], {
      cwd,
      allowFailure: true,
    });

    if (hasParentCommit.status !== 0) {
      const headRef = options.head || 'HEAD';
      rangeArgs = [EMPTY_TREE_SHA, headRef];
      effectiveRange = `${EMPTY_TREE_SHA}..${headRef}`;
    }
  }

  const rawArgs = ['diff', '--raw', '-z', '--find-renames', '--no-ext-diff', ...rangeArgs];
  const rawResult = runGit(rawArgs, { cwd });
  const rawEntries = parseRawDiffZ(rawResult.stdout);

  const selectedEntries = rawEntries.filter((entry) =>
    selectEntry(entry, includeMatchers, excludeMatchers),
  );
  const categories = createEmptyCategories();
  const fileDetails = [];

  let shortstat = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    raw: '',
  };

  if (selectedEntries.length > 0) {
    const pathspecSet = new Set();
    for (const entry of selectedEntries) {
      if (entry.status === 'R' || entry.status === 'C') {
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
      'diff',
      '--shortstat',
      '--find-renames',
      '--no-ext-diff',
      ...rangeArgs,
      '--',
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

      const result = runGit(['cat-file', '-p', sha], {
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
      if ((entry.status === 'R' || entry.status === 'C') && entry.oldPath && entry.newPath) {
        patchPathspecs.push(`:(literal)${entry.oldPath}`);
        patchPathspecs.push(`:(literal)${entry.newPath}`);
      } else {
        patchPathspecs.push(`:(literal)${diffPath}`);
      }

      const patchArgs = [
        'diff',
        '--no-color',
        '--unified=0',
        '--find-renames',
        '--no-ext-diff',
        ...rangeArgs,
        '--',
        ...patchPathspecs,
      ];

      const patchResult = runGit(patchArgs, { cwd });
      const delta = classifyPatchText(patchResult.stdout, entry, getCommentLines);
      addCategoryTotals(categories, delta);
      fileDetails.push({ path: diffPath, categories: delta });
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
    fileDetails,
  };
}

export { generateStats };
