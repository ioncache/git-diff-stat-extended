import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { generateStats } from './gdsx-lib.js';
import {
  renderTextOutput,
  renderGroupedTextOutput,
  renderJsonOutput,
  formatErrorMessage,
} from './gdsx-render.js';

/**
 * @typedef {Object} CliTotals
 * @property {number} filesChanged - Number of changed files.
 * @property {number} insertions - Number of inserted lines.
 * @property {number} deletions - Number of deleted lines.
 */

/**
 * @typedef {Object} CliLineCounts
 * @property {number} insertions - Number of inserted lines.
 * @property {number} deletions - Number of deleted lines.
 */

/**
 * @typedef {Object} CliCategories
 * @property {CliLineCounts} implementation - Implementation totals.
 * @property {CliLineCounts} tests - Test totals.
 * @property {CliLineCounts} comments - Comment totals.
 * @property {CliLineCounts} documentation - Documentation totals.
 * @property {CliLineCounts} configuration - Configuration totals.
 */

/**
 * @typedef {Object} CliReconciliation
 * @property {boolean} pass - Whether computed totals match git totals.
 * @property {CliLineCounts} expected - Expected totals from git shortstat.
 * @property {CliLineCounts} computed - Computed totals from category rollup.
 */

/**
 * @typedef {Object} CliFilters
 * @property {string[]} include - Include patterns.
 * @property {string[]} exclude - Exclude patterns.
 */

/**
 * @typedef {Object} CliSelectedFile
 * @property {string} status - Git raw diff status code.
 * @property {string|null} oldPath - Source path.
 * @property {string|null} newPath - Destination path.
 * @property {string} path - Primary display path.
 */

/**
 * @typedef {Object} CliFileDetail
 * @property {string} path - Display path for the file.
 * @property {CliCategories} categories - Per-file category breakdown.
 */

/**
 * @typedef {Object} CliExtensionGroup
 * @property {string} extension - File extension label.
 * @property {number} fileCount - Number of files in the group.
 * @property {CliCategories} categories - Aggregated category totals for the group.
 */

/**
 * @typedef {Object} CliReport
 * @property {string} shortstatLine - Human-readable shortstat line.
 * @property {CliTotals} total - Authoritative totals.
 * @property {CliCategories} categories - Category totals.
 * @property {CliReconciliation} reconciliation - Reconciliation details.
 * @property {string} range - Effective range string.
 * @property {CliFilters} filters - Applied filters.
 * @property {CliSelectedFile[]} selectedFiles - Selected files.
 * @property {CliFileDetail[]} fileDetails - Per-file category breakdowns.
 */

/**
 * @typedef {Object} CliArgv
 * @property {string} [base] - Base ref used with head.
 * @property {string} [head] - Head ref used with base.
 * @property {string} [range] - Explicit git revset.
 * @property {string[]} [include] - Include glob patterns.
 * @property {string[]} [exclude] - Exclude glob patterns.
 * @property {boolean} json - Whether to emit JSON output.
 * @property {boolean} showReconciliation - Whether to display reconciliation on pass.
 * @property {boolean} groupByExtension - Whether to group output by file extension.
 */

/**
 * Parses and validates command-line arguments.
 *
 * @returns {CliArgv} Parsed CLI arguments.
 * @throws {Error} When incompatible arguments are provided.
 */
function parseArgv() {
  return yargs(hideBin(process.argv))
    .scriptName('gdsx')
    .usage('$0 [options]')
    .option('base', {
      type: 'string',
      description: 'Base ref used with --head (default HEAD~1)',
    })
    .option('head', {
      type: 'string',
      description: 'Head ref used with --base (default HEAD)',
    })
    .option('range', {
      type: 'string',
      description: 'Git revision range expression (for example main...HEAD)',
    })
    .option('include', {
      type: 'string',
      array: true,
      description: 'Include glob pattern, repeatable',
    })
    .option('exclude', {
      type: 'string',
      array: true,
      description: 'Exclude glob pattern, repeatable',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      description: 'Emit JSON output',
    })
    .option('show-reconciliation', {
      type: 'boolean',
      default: false,
      description: 'Show reconciliation line when it passes',
    })
    .option('group-by-extension', {
      type: 'boolean',
      default: false,
      description: 'Group category breakdown by file extension',
    })
    .check((argv) => {
      if (argv.range && (argv.base || argv.head)) {
        throw new Error('Use either --range or --base/--head, not both.');
      }
      return true;
    })
    .strict()
    .help()
    .parseSync();
}

/**
 * Entrypoint for CLI execution.
 *
 * @returns {void}
 */
function main() {
  try {
    const argv = parseArgv();
    const report = generateStats({
      base: argv.base,
      head: argv.head,
      range: argv.range,
      include: argv.include,
      exclude: argv.exclude,
    });

    if (argv.json) {
      renderJsonOutput(report);
    } else if (argv.groupByExtension) {
      renderGroupedTextOutput(report, { showReconciliation: argv.showReconciliation });
    } else {
      renderTextOutput(report, { showReconciliation: argv.showReconciliation });
    }

    if (!report.reconciliation.pass) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(formatErrorMessage(message));
    process.exitCode = 1;
  }
}

export { main };
