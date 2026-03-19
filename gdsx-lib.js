const { spawnSync } = require('child_process');
const picomatch = require('picomatch');
const babelParser = require('@babel/parser');

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to run git: ${result.error.message}`);
  }

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = (result.stderr || '').trim();
    const suffix = stderr ? `\n${stderr}` : '';
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.status}.${suffix}`);
  }

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function zeroSha(sha) {
  return !sha || /^0+$/.test(sha);
}

function parseRawDiffZ(rawText) {
  if (!rawText) {
    return [];
  }

  const tokens = rawText.split('\0');
  if (tokens[tokens.length - 1] === '') {
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

    if (status === 'R' || status === 'C') {
      oldPath = tokens[i++] || null;
      newPath = tokens[i++] || null;
    } else {
      const path = tokens[i++] || null;
      if (status === 'A') {
        newPath = path;
      } else if (status === 'D') {
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
      displayPath: newPath || oldPath || '',
    });
  }

  return entries;
}

function parseShortstat(shortstatText) {
  const text = (shortstatText || '').trim();
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

function formatShortstatLine(filesChanged, insertions, deletions) {
  const filesWord = filesChanged === 1 ? 'file' : 'files';
  const insertionsWord = insertions === 1 ? 'insertion' : 'insertions';
  const deletionsWord = deletions === 1 ? 'deletion' : 'deletions';
  return `${filesChanged} ${filesWord} changed, ${insertions} ${insertionsWord}(+), ${deletions} ${deletionsWord}(-)`;
}

function normalizePatterns(values) {
  if (!values) {
    return [];
  }
  if (Array.isArray(values)) {
    return values.filter(Boolean);
  }
  return [values].filter(Boolean);
}

function buildMatchers(patterns) {
  return patterns.map((pattern) => picomatch(pattern, { dot: true }));
}

function isTestPath(path) {
  const lower = (path || '').toLowerCase();
  if (!lower) {
    return false;
  }
  const hasTestSegment = /(^|\/)(test|tests|__tests__)(\/|$)/.test(lower);
  const hasTestFileName = /\.(test|spec)\.[^/]+$/.test(lower);
  return hasTestSegment || hasTestFileName;
}

function isJsTsPath(path) {
  return /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i.test(path || '');
}

function pathSelected(path, includeMatchers, excludeMatchers) {
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

function selectEntry(entry, includeMatchers, excludeMatchers) {
  const candidate = entry.displayPath || entry.newPath || entry.oldPath;
  return pathSelected(candidate, includeMatchers, excludeMatchers);
}

function parseCommentsByLine(sourceText, filePath) {
  const commentsByLine = new Set();

  const ext = (filePath.split('.').pop() || '').toLowerCase();
  const isTs = ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts';
  const isJsxLike = ext === 'jsx' || ext === 'tsx';

  const pluginSets = [];
  if (isTs && isJsxLike) {
    pluginSets.push(['typescript', 'jsx']);
    pluginSets.push(['typescript']);
  } else if (isTs) {
    pluginSets.push(['typescript']);
    pluginSets.push(['typescript', 'jsx']);
  } else if (isJsxLike) {
    pluginSets.push(['jsx']);
    pluginSets.push([]);
  } else {
    pluginSets.push([]);
    pluginSets.push(['jsx']);
  }

  let ast = null;
  let lastError = null;

  for (const plugins of pluginSets) {
    try {
      ast = babelParser.parse(sourceText, {
        sourceType: 'unambiguous',
        plugins,
        errorRecovery: true,
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!ast) {
    const reason = lastError ? lastError.message : 'unknown parser error';
    throw new Error(`Unable to parse ${filePath} for comments: ${reason}`);
  }

  for (const comment of ast.comments || []) {
    if (!comment.loc) {
      continue;
    }
    for (let line = comment.loc.start.line; line <= comment.loc.end.line; line += 1) {
      commentsByLine.add(line);
    }
  }

  return commentsByLine;
}

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

function classifyLine(side, lineNumber, entry, commentLineProvider) {
  const sidePath = side === 'old' ? entry.oldPath : entry.newPath;
  if (!sidePath) {
    return 'implementation';
  }

  if (isTestPath(sidePath)) {
    return 'tests';
  }

  if (isJsTsPath(sidePath)) {
    const sideSha = side === 'old' ? entry.oldSha : entry.newSha;
    if (!zeroSha(sideSha)) {
      const commentLines = commentLineProvider(sideSha, sidePath);
      if (commentLines.has(lineNumber)) {
        return 'comments';
      }
    }
  }

  return 'implementation';
}

function classifyPatchText(patchText, entry, commentLineProvider) {
  const result = {
    implementation: { insertions: 0, deletions: 0 },
    tests: { insertions: 0, deletions: 0 },
    comments: { insertions: 0, deletions: 0 },
  };

  if (!patchText) {
    return result;
  }

  const lines = patchText.split('\n');
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

    if (line.startsWith('+') && !line.startsWith('+++')) {
      const category = classifyLine('new', newLine, entry, commentLineProvider);
      result[category].insertions += 1;
      newLine += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      const category = classifyLine('old', oldLine, entry, commentLineProvider);
      result[category].deletions += 1;
      oldLine += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      oldLine += 1;
      newLine += 1;
    }
  }

  return result;
}

function addCategoryTotals(target, delta) {
  target.implementation.insertions += delta.implementation.insertions;
  target.implementation.deletions += delta.implementation.deletions;
  target.tests.insertions += delta.tests.insertions;
  target.tests.deletions += delta.tests.deletions;
  target.comments.insertions += delta.comments.insertions;
  target.comments.deletions += delta.comments.deletions;
}

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

function buildRangeArgs(input) {
  if (input.range) {
    return [input.range];
  }
  return [input.base || 'HEAD~1', input.head || 'HEAD'];
}

function createEmptyCategories() {
  return {
    implementation: { insertions: 0, deletions: 0 },
    tests: { insertions: 0, deletions: 0 },
    comments: { insertions: 0, deletions: 0 },
  };
}

function generateStats(options = {}) {
  const includePatterns = normalizePatterns(options.include);
  const excludePatterns = normalizePatterns(options.exclude);

  const includeMatchers = buildMatchers(includePatterns);
  const excludeMatchers = buildMatchers(excludePatterns);
  const rangeArgs = buildRangeArgs(options);
  const cwd = options.cwd || process.cwd();

  const rawArgs = ['diff', '--raw', '-z', '--find-renames', '--no-ext-diff', ...rangeArgs];
  const rawResult = runGit(rawArgs, { cwd });
  const rawEntries = parseRawDiffZ(rawResult.stdout);

  const selectedEntries = rawEntries.filter((entry) => selectEntry(entry, includeMatchers, excludeMatchers));
  const categories = createEmptyCategories();

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

    const shortstatArgs = ['diff', '--shortstat', '--find-renames', '--no-ext-diff', ...rangeArgs, '--', ...pathspecSet];
    const shortstatResult = runGit(shortstatArgs, { cwd });
    shortstat = parseShortstat(shortstatResult.stdout);

    const commentLineCache = new Map();
    const blobTextCache = new Map();

    function getBlobText(sha) {
      if (blobTextCache.has(sha)) {
        return blobTextCache.get(sha);
      }

      const result = runGit(['cat-file', '-p', sha], { cwd, allowFailure: true });
      const text = result.status === 0 ? result.stdout : null;
      blobTextCache.set(sha, text);
      return text;
    }

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
    range: options.range || `${options.base || 'HEAD~1'}..${options.head || 'HEAD'}`,
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

module.exports = {
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
