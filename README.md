# git-diff-stat-extended

Extended git diff stats for local workflows, exposed as the `gdsx` CLI.

`gdsx` preserves authoritative git totals and adds a categorized breakdown:

- implementation
- tests
- comments
- documentation
- configuration

It enforces strict reconciliation:

- implementation.insertions + tests.insertions + comments.insertions + documentation.insertions + configuration.insertions = total.insertions
- implementation.deletions + tests.deletions + comments.deletions + documentation.deletions + configuration.deletions = total.deletions

If reconciliation fails, `gdsx` prints diagnostics and exits non-zero.

- [git-diff-stat-extended](#git-diff-stat-extended)
  - [Motivation](#motivation)
  - [Features](#features)
  - [Category classification](#category-classification)
  - [Installation](#installation)
  - [Usage](#usage)
    - [Default comparison](#default-comparison)
    - [Options](#options)
    - [Examples](#examples)
  - [Output](#output)
    - [Default text mode](#default-text-mode)
    - [Grouped by extension (`--group-by-extension`)](#grouped-by-extension---group-by-extension)
    - [JSON mode (`--json`)](#json-mode---json)
  - [Reconciliation guarantees](#reconciliation-guarantees)
  - [Contributing](#contributing)
  - [Known limitations](#known-limitations)
  - [License](#license)

## Motivation

`git diff --shortstat` gives trustworthy totals, but not the context needed to quickly understand where change effort went. `gdsx` keeps git as the source of truth while adding a practical implementation/test/comment breakdown that still reconciles exactly to global insertions and deletions.

## Features

- Uses git CLI as source of truth (`--raw -z`, `--shortstat`, and patch hunks)
- Handles add/modify/delete/rename/copy
- Safe path handling via NUL-delimited parsing and literal pathspecs
- Parser-backed JS/TS comment detection using `@babel/parser`
- Repeatable include/exclude glob filters
- Text table output with net column and git-style color defaults
- JSON mode for machine-readable integration

## Category classification

Each changed line is assigned to exactly one category. Classification is
determined by file path, evaluated in priority order:

| Priority | Category           | Matches                                                                                                                                                                         |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | **tests**          | Files inside `test/`, `tests/`, or `__tests__/` directories, or filenames containing `.test.*` or `.spec.*`                                                                     |
| 2        | **documentation**  | `.md`, `.txt`, `.rst`, `.adoc` extensions, or bare filenames `LICENSE`, `LICENCE`, `CHANGELOG`, `CHANGES`, `AUTHORS`, `CONTRIBUTORS`, `README`                                  |
| 3        | **configuration**  | `.json`, `.jsonc`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env`, `.properties` extensions; any dotfile (basename starting with `.`); or filenames matching `*.config.*` or `*.rc.*` |
| 4        | **comments**       | Lines identified as comments by `@babel/parser` inside JS/TS files (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`)                                               |
| 5        | **implementation** | Everything else (default)                                                                                                                                                       |

Earlier rules take precedence. A `.test.js` file is always **tests**, never
**comments** or **implementation**. Comment detection only applies to JS/TS
files that are not already matched by a higher-priority rule.

## Installation

> **Note:** This package is not yet published to npm. The command below will
> work once it is available.

```bash
npm install -g git-diff-stat-extended
```

For development installation, see [docs/development.md](docs/development.md).

## Usage

```bash
gdsx [options] [<git-diff-args>...]
```

`gdsx` is a thin wrapper around `git diff`. Any arguments not consumed by
`gdsx` are forwarded directly to `git diff`, so commits, ranges, and
git-specific flags work exactly as you would expect.

### Default comparison

Running bare `gdsx` with no arguments is equivalent to `git diff HEAD`, which
shows all uncommitted changes (staged and unstaged) compared to the last
commit.

### Options

| Flag                    | Type    | Default | Description                                                                 |
| ----------------------- | ------- | ------- | --------------------------------------------------------------------------- |
| `--include <glob>`      | string  |         | Include glob pattern (repeatable). For renames/copies, matches the new path |
| `--exclude <glob>`      | string  |         | Exclude glob pattern (repeatable). For renames/copies, matches the new path |
| `--json`                | boolean | `false` | Emit structured JSON output                                                 |
| `--show-reconciliation` | boolean | `false` | Show the reconciliation line when it passes (always shown on fail)          |
| `--group-by-extension`  | boolean | `false` | Group the category breakdown by file extension                              |

### Examples

```bash
# All uncommitted changes vs last commit (default)
gdsx

# Last commit
gdsx HEAD~1..HEAD

# Compare branch tip against main
gdsx main..HEAD

# Symmetric range expression
gdsx main...HEAD

# Include only src and tests
gdsx --include 'src/**' --include 'tests/**' main..HEAD

# Exclude generated files
gdsx --exclude '**/*.snap' --exclude 'dist/**'

# JSON output
gdsx --json main..HEAD
```

## Output

### Default text mode

Prints a category table with a header showing files changed and the comparison range:

```text
┌──────────────────────────────────────────────────────┐
│ 38 files changed  ·  c7729b0..HEAD                   │
├─────────────────┬────────────┬───────────┬───────────┤
│ Category        │ Insertions │ Deletions │       Net │
├─────────────────┼────────────┼───────────┼───────────┤
│ implementation  │      +1940 │      -771 │     +1169 │
├─────────────────┼────────────┼───────────┼───────────┤
│ tests           │       +959 │      -201 │      +758 │
├─────────────────┼────────────┼───────────┼───────────┤
│ comments        │       +406 │        -0 │      +406 │
├─────────────────┼────────────┼───────────┼───────────┤
│ documentation   │         +0 │        -0 │         0 │
├─────────────────┼────────────┼───────────┼───────────┤
│ configuration   │         +0 │        -0 │         0 │
├─────────────────┼────────────┼───────────┼───────────┤
│ total           │      +3305 │      -972 │     +2333 │
└─────────────────┴────────────┴───────────┴───────────┘
```

When reconciliation fails, a `FAIL` line and diagnostics block are printed and the process exits non-zero. Use `--show-reconciliation` to also display the reconciliation line on pass.

### Grouped by extension (`--group-by-extension`)

Breaks down categories within each file extension group, sorted alphabetically:

```text
┌───────────────────────────────────────────────────────┐
│ 38 files changed  ·  c7729b0..HEAD                    │
├───────────────────┬────────────┬───────────┬──────────┤
│ Category          │ Insertions │ Deletions │      Net │
├───────────────────┴────────────┴───────────┴──────────┤
│ .js (13 files)                                        │
├───────────────────┬────────────┬───────────┬──────────┤
│   implementation  │       +880 │      -525 │     +355 │
│   tests           │       +959 │      -201 │     +758 │
│   comments        │       +400 │        -0 │     +400 │
│   documentation   │         +0 │        -0 │        0 │
│   configuration   │         +0 │        -0 │        0 │
├───────────────────┴────────────┴───────────┴──────────┤
│ .json (7 files)                                       │
├───────────────────┬────────────┬───────────┬──────────┤
│   implementation  │         +0 │        -0 │        0 │
│   tests           │         +0 │        -0 │        0 │
│   comments        │         +0 │        -0 │        0 │
│   documentation   │         +0 │        -0 │        0 │
│   configuration   │       +125 │        -9 │     +116 │
├───────────────────┴────────────┴───────────┴──────────┤
│ .jsonc (2 files)                                      │
├───────────────────┬────────────┬───────────┬──────────┤
│   implementation  │         +0 │        -0 │        0 │
│   tests           │         +0 │        -0 │        0 │
│   comments        │         +0 │        -0 │        0 │
│   documentation   │         +0 │        -0 │        0 │
│   configuration   │         +8 │        -0 │       +8 │
├───────────────────┴────────────┴───────────┴──────────┤
│ .md (8 files)                                         │
├───────────────────┬────────────┬───────────┬──────────┤
│   implementation  │         +0 │        -0 │        0 │
│   tests           │         +0 │        -0 │        0 │
│   comments        │         +0 │        -0 │        0 │
│   documentation   │       +877 │       -10 │     +867 │
│   configuration   │         +0 │        -0 │        0 │
├───────────────────┴────────────┴───────────┴──────────┤
│ .mjs (1 file)                                         │
├───────────────────┬────────────┬───────────┬──────────┤
│   implementation  │        +25 │        -0 │      +25 │
│   tests           │         +0 │        -0 │        0 │
│   comments        │         +6 │        -0 │       +6 │
│   documentation   │         +0 │        -0 │        0 │
│   configuration   │         +0 │        -0 │        0 │
├───────────────────┴────────────┴───────────┴──────────┤
│ (no extension) (7 files)                              │
├───────────────────┬────────────┬───────────┬──────────┤
│   implementation  │        +25 │      -227 │     -202 │
│   tests           │         +0 │        -0 │        0 │
│   comments        │         +0 │        -0 │        0 │
│   documentation   │         +0 │        -0 │        0 │
│   configuration   │         +0 │        -0 │        0 │
├───────────────────┼────────────┼───────────┼──────────┤
│ total             │      +3305 │      -972 │    +2333 │
└───────────────────┴────────────┴───────────┴──────────┘
```

### JSON mode (`--json`)

JSON output includes:

- `shortstatLine`
- `total`
- `categories`
- `reconciliation`
- `range`
- `filters`
- `selectedFiles`
- `fileDetails` — per-file category breakdowns

## Reconciliation guarantees

`gdsx` compares computed category sums to authoritative git totals.

When mismatch occurs:

- reconciliation status is `FAIL`
- diagnostics are printed
- process exit code is non-zero

This makes the tool safe for scripting and CI checks.

## Contributing

See [docs/development.md](docs/development.md) for setup, testing, and release
instructions.

## Known limitations

- The comment parser currently only works for JS/TS-family files
- Non-JS/TS files are categorized as implementation unless they match test, documentation, or configuration rules
- For files with syntax parse failures, comment classification for that side may fall back to implementation

## License

[MIT](LICENSE)
