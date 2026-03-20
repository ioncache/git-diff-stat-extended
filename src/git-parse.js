import { spawnSync } from "node:child_process";

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
 * @typedef {Object} HunkHeader
 * @property {number} oldLine - Starting old-side line number.
 * @property {number} newLine - Starting new-side line number.
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

export { runGit, zeroSha, parseRawDiffZ, parseShortstat, formatShortstatLine, parseHunkHeader };
