import { spawnSync } from "node:child_process";
import path from "node:path";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import pc from "picocolors";
import Table from "cli-table3";
import { generateStats } from "./gdsx-lib.js";

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
 * @property {boolean} verbose - Whether to emit extra diagnostics.
 * @property {boolean} showReconciliation - Whether to display reconciliation on pass.
 * @property {boolean} groupByExtension - Whether to group output by file extension.
 */

/**
 * Reads git's color.ui configuration value.
 *
 * @returns {'always'|'never'|string|null} Git color setting or null when unavailable.
 */
function readGitColorUiSetting() {
  const result = spawnSync("git", ["config", "--get", "color.ui"], {
    encoding: "utf8",
  });

  /* istanbul ignore next -- depends on local git availability/config outside deterministic unit-test control */
  if (result.status !== 0) {
    return null;
  }

  const value = (result.stdout || "").trim().toLowerCase();
  return value || null;
}

/**
 * Resolves terminal color behavior from environment variables and git config.
 *
 * @returns {ReturnType<typeof pc.createColors>} Color helpers for output formatting.
 */
function colorsForOutput() {
  if (process.env.NO_COLOR !== undefined) {
    return pc.createColors(false);
  }

  const forced = process.env.FORCE_COLOR;
  if (forced !== undefined) {
    return pc.createColors(forced !== "0");
  }

  const gitColorUi = readGitColorUiSetting();
  if (gitColorUi === "always") {
    return pc.createColors(true);
  }
  if (gitColorUi === "never") {
    return pc.createColors(false);
  }

  return pc.createColors(Boolean(process.stdout.isTTY));
}

const colors = colorsForOutput();

/**
 * Formats signed insertion and deletion values with colors.
 *
 * @param {number} insertions - Insertion count.
 * @param {number} deletions - Deletion count.
 * @returns {string} Colorized signed counts.
 */
function fmtSigned(insertions, deletions) {
  return `${colors.green(`+${insertions}`)} ${colors.red(`-${deletions}`)}`;
}

/**
 * Formats an insertion value with the insert color.
 *
 * @param {number} value - Insertion count.
 * @returns {string} Colorized insertion value.
 */
function fmtInsertion(value) {
  return colors.green(`+${value}`);
}

/**
 * Formats a deletion value with the delete color.
 *
 * @param {number} value - Deletion count.
 * @returns {string} Colorized deletion value.
 */
function fmtDeletion(value) {
  return colors.red(`-${value}`);
}

/**
 * Formats a net delta with positive and negative color styling.
 *
 * @param {number} value - Net value to render.
 * @returns {string} Colorized net value.
 */
function fmtNet(value) {
  if (value > 0) {
    return colors.green(`+${value}`);
  }
  if (value < 0) {
    return colors.red(`${value}`);
  }
  return `${value}`;
}

/**
 * Renders a header label with files changed count and range.
 *
 * @param {CliTotals} total - Totals to render.
 * @param {string} range - Effective git range string.
 * @returns {string} Formatted header label.
 */
function renderHeaderLabel(total, range) {
  const filesWord = total.filesChanged === 1 ? "file" : "files";
  return `${total.filesChanged} ${filesWord} changed  ·  ${range}`;
}

/**
 * Prints human-readable CLI output for an extended diff report.
 *
 * @param {CliReport} report - Report to print.
 * @param {{ showReconciliation: boolean }} options - Display options.
 * @returns {void}
 *
 * @example
 * renderTextOutput(report, { showReconciliation: false });
 */
function renderTextOutput(report, options) {
  const { total, categories, reconciliation } = report;

  const categoryNames = ["implementation", "tests", "comments", "documentation", "configuration"];
  const rows = categoryNames.map((name) => ({
    category: name,
    insertions: categories[name].insertions,
    deletions: categories[name].deletions,
  }));

  const table = new Table({
    colAligns: ["left", "right", "right", "right"],
    style: { head: [], border: [] },
  });

  table.push([{ colSpan: 4, content: renderHeaderLabel(total, report.range) }]);
  table.push(["Category", "Insertions", "Deletions", "Net"]);

  for (const row of rows) {
    const net = row.insertions - row.deletions;
    table.push([
      row.category,
      fmtInsertion(row.insertions),
      fmtDeletion(row.deletions),
      fmtNet(net),
    ]);
  }

  table.push([
    colors.bold("total"),
    colors.bold(fmtInsertion(total.insertions)),
    colors.bold(fmtDeletion(total.deletions)),
    colors.bold(fmtNet(total.insertions - total.deletions)),
  ]);

  console.log(table.toString());

  const showReconciliationLine = !reconciliation.pass || options.showReconciliation;

  if (showReconciliationLine) {
    const statusLabel = reconciliation.pass ? colors.green("PASS") : colors.red("FAIL");
    console.log(
      `${statusLabel} reconciliation: expected ${fmtSigned(reconciliation.expected.insertions, reconciliation.expected.deletions)}, ` +
        `computed ${fmtSigned(reconciliation.computed.insertions, reconciliation.computed.deletions)}`,
    );
  }

  if (!reconciliation.pass) {
    console.error("Diagnostics:");
    for (const name of ["implementation", "tests", "comments", "documentation", "configuration"]) {
      console.error(
        `  ${name}: ${fmtSigned(categories[name].insertions, categories[name].deletions)}`,
      );
    }
    console.error(`  total: ${fmtSigned(total.insertions, total.deletions)}`);
  }
}

/**
 * Groups file details by extension and aggregates category totals.
 *
 * @param {CliFileDetail[]} fileDetails - Per-file category breakdowns.
 * @returns {CliExtensionGroup[]} Extension groups sorted by total changes descending.
 */
function groupFileDetailsByExtension(fileDetails) {
  const groups = new Map();

  for (const file of fileDetails) {
    const ext = path.extname(file.path) || "(no extension)";
    if (!groups.has(ext)) {
      groups.set(ext, {
        extension: ext,
        fileCount: 0,
        categories: {
          implementation: { insertions: 0, deletions: 0 },
          tests: { insertions: 0, deletions: 0 },
          comments: { insertions: 0, deletions: 0 },
          documentation: { insertions: 0, deletions: 0 },
          configuration: { insertions: 0, deletions: 0 },
        },
      });
    }

    const group = groups.get(ext);
    group.fileCount += 1;
    for (const cat of ["implementation", "tests", "comments", "documentation", "configuration"]) {
      group.categories[cat].insertions += file.categories[cat].insertions;
      group.categories[cat].deletions += file.categories[cat].deletions;
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.extension === "(no extension)") return 1;
    if (b.extension === "(no extension)") return -1;
    return a.extension.localeCompare(b.extension);
  });
}

/**
 * Removes horizontal border lines between consecutive sub-rows in a rendered table string.
 *
 * @param {string} tableString - Rendered cli-table3 output.
 * @param {string[]} rowTypes - Ordered row type labels matching table content rows.
 * @returns {string} Table string with sub-row borders stripped.
 */
function stripSubRowBorders(tableString, rowTypes) {
  const lines = tableString.split("\n");
  const result = [];
  let contentIndex = -1;

  for (const line of lines) {
    if (line.startsWith("\u2502") || line.startsWith("│")) {
      contentIndex++;
      result.push(line);
    } else if (line.startsWith("\u251C") || line.startsWith("├")) {
      const prevType = rowTypes[contentIndex];
      const nextType = rowTypes[contentIndex + 1];
      if (prevType === "sub" && nextType === "sub") {
        continue;
      }
      result.push(line);
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Prints human-readable CLI output grouped by file extension.
 *
 * @param {CliReport} report - Report to print.
 * @param {{ showReconciliation: boolean }} options - Display options.
 * @returns {void}
 *
 * @example
 * renderGroupedTextOutput(report, { showReconciliation: false });
 */
function renderGroupedTextOutput(report, options) {
  const { total, reconciliation } = report;
  const extensionGroups = groupFileDetailsByExtension(report.fileDetails);

  const table = new Table({
    colAligns: ["left", "right", "right", "right"],
    style: { head: [], border: [] },
  });

  const rowTypes = [];

  table.push([{ colSpan: 4, content: renderHeaderLabel(total, report.range) }]);
  rowTypes.push("title");
  table.push(["Category", "Insertions", "Deletions", "Net"]);
  rowTypes.push("header");

  for (const group of extensionGroups) {
    const filesWord = group.fileCount === 1 ? "file" : "files";
    table.push([
      { colSpan: 4, content: colors.bold(`${group.extension} (${group.fileCount} ${filesWord})`) },
    ]);
    rowTypes.push("group");

    for (const cat of ["implementation", "tests", "comments", "documentation", "configuration"]) {
      const ins = group.categories[cat].insertions;
      const del = group.categories[cat].deletions;
      const net = ins - del;
      table.push([`  ${cat}`, fmtInsertion(ins), fmtDeletion(del), fmtNet(net)]);
      rowTypes.push("sub");
    }
  }

  table.push([
    colors.bold("total"),
    colors.bold(fmtInsertion(total.insertions)),
    colors.bold(fmtDeletion(total.deletions)),
    colors.bold(fmtNet(total.insertions - total.deletions)),
  ]);
  rowTypes.push("total");

  console.log(stripSubRowBorders(table.toString(), rowTypes));

  const showReconciliationLine = !reconciliation.pass || options.showReconciliation;

  if (showReconciliationLine) {
    const statusLabel = reconciliation.pass ? colors.green("PASS") : colors.red("FAIL");
    console.log(
      `${statusLabel} reconciliation: expected ${fmtSigned(reconciliation.expected.insertions, reconciliation.expected.deletions)}, ` +
        `computed ${fmtSigned(reconciliation.computed.insertions, reconciliation.computed.deletions)}`,
    );
  }

  if (!reconciliation.pass) {
    console.error("Diagnostics:");
    for (const name of ["implementation", "tests", "comments", "documentation", "configuration"]) {
      console.error(
        `  ${name}: ${fmtSigned(report.categories[name].insertions, report.categories[name].deletions)}`,
      );
    }
    console.error(`  total: ${fmtSigned(total.insertions, total.deletions)}`);
  }
}

/**
 * Prints JSON output for an extended diff report.
 *
 * @param {CliReport} report - Report to serialize.
 * @returns {void}
 *
 * @example
 * renderJsonOutput(report);
 */
function renderJsonOutput(report) {
  console.log(
    JSON.stringify(
      {
        shortstatLine: report.shortstatLine,
        total: report.total,
        categories: report.categories,
        reconciliation: report.reconciliation,
        range: report.range,
        filters: report.filters,
        selectedFiles: report.selectedFiles,
        fileDetails: report.fileDetails,
      },
      null,
      2,
    ),
  );
}

/**
 * Parses and validates command-line arguments.
 *
 * @returns {CliArgv} Parsed CLI arguments.
 * @throws {Error} When incompatible arguments are provided.
 */
function parseArgv() {
  return yargs(hideBin(process.argv))
    .scriptName("gdsx")
    .usage("$0 [options]")
    .option("base", {
      type: "string",
      description: "Base ref used with --head (default HEAD~1)",
    })
    .option("head", {
      type: "string",
      description: "Head ref used with --base (default HEAD)",
    })
    .option("range", {
      type: "string",
      description: "Git revision range expression (for example main...HEAD)",
    })
    .option("include", {
      type: "string",
      array: true,
      description: "Include glob pattern, repeatable",
    })
    .option("exclude", {
      type: "string",
      array: true,
      description: "Exclude glob pattern, repeatable",
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Emit JSON output",
    })
    .option("verbose", {
      type: "boolean",
      default: false,
      description: "Print warnings and additional diagnostics",
    })
    .option("show-reconciliation", {
      type: "boolean",
      default: false,
      description: "Show reconciliation line when it passes",
    })
    .option("group-by-extension", {
      type: "boolean",
      default: false,
      description: "Group category breakdown by file extension",
    })
    .check((argv) => {
      if (argv.range && (argv.base || argv.head)) {
        throw new Error("Use either --range or --base/--head, not both.");
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
      verbose: argv.verbose,
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
    console.error(colors.red(`gdsx error: ${message}`));
    process.exitCode = 1;
  }
}

export { main };
