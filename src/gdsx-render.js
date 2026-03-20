import { spawnSync } from "node:child_process";
import path from "node:path";
import pc from "picocolors";
import Table from "cli-table3";
import { CATEGORY_NAMES } from "./classify.js";

/**
 * @typedef {import('./gdsx-cli.js').CliReport} CliReport
 * @typedef {import('./gdsx-cli.js').CliTotals} CliTotals
 * @typedef {import('./gdsx-cli.js').CliFileDetail} CliFileDetail
 * @typedef {import('./gdsx-cli.js').CliExtensionGroup} CliExtensionGroup
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
 * Prints reconciliation status and diagnostics when needed.
 *
 * @param {CliReport} report - Report containing reconciliation and category data.
 * @param {{ showReconciliation: boolean }} options - Display options.
 * @returns {void}
 */
function renderReconciliation(report, options) {
  const { total, categories, reconciliation } = report;
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
    for (const name of CATEGORY_NAMES) {
      console.error(
        `  ${name}: ${fmtSigned(categories[name].insertions, categories[name].deletions)}`,
      );
    }
    console.error(`  total: ${fmtSigned(total.insertions, total.deletions)}`);
  }
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
  const { total, categories } = report;

  const rows = CATEGORY_NAMES.map((name) => ({
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
  renderReconciliation(report, options);
}

/**
 * Groups file details by extension and aggregates category totals.
 *
 * @param {CliFileDetail[]} fileDetails - Per-file category breakdowns.
 * @returns {CliExtensionGroup[]} Extension groups sorted by extension name.
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
    for (const cat of CATEGORY_NAMES) {
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
  const { total } = report;
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

    for (const cat of CATEGORY_NAMES) {
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
  renderReconciliation(report, options);
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
 * Formats a CLI error message with red styling.
 *
 * @param {string} message - Error message text.
 * @returns {string} Colorized error string.
 */
function formatErrorMessage(message) {
  return colors.red(`gdsx error: ${message}`);
}

export { renderTextOutput, renderGroupedTextOutput, renderJsonOutput, formatErrorMessage };
