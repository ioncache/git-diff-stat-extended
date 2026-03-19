# git-diff-stat-extended

Extended git diff stats for local workflows, exposed as the `gdsx` CLI.

`gdsx` preserves authoritative git totals and adds a categorized breakdown:

- implementation
- tests
- comments

It enforces strict reconciliation:

- implementation.insertions + tests.insertions + comments.insertions = total.insertions
- implementation.deletions + tests.deletions + comments.deletions = total.deletions

If reconciliation fails, `gdsx` prints diagnostics and exits non-zero.

- [git-diff-stat-extended](#git-diff-stat-extended)
  - [Motivation](#motivation)
  - [Features](#features)
  - [Installation](#installation)
    - [Option 1: Local development](#option-1-local-development)
    - [Option 2: Global install from local path](#option-2-global-install-from-local-path)
    - [Option 3: Global install from GitHub repo](#option-3-global-install-from-github-repo)
  - [Usage](#usage)
    - [Default comparison](#default-comparison)
    - [Options](#options)
    - [Examples](#examples)
  - [Output](#output)
  - [Reconciliation guarantees](#reconciliation-guarantees)
  - [Development](#development)
  - [Release](#release)
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

## Installation

### Option 1: Local development

```bash
cd ~/projects/personal/git-diff-stat-extended
npm install
chmod +x gdsx
npm link
```

Then run from any git repository:

```bash
gdsx
```

### Option 2: Global install from local path

```bash
npm install -g ~/projects/personal/git-diff-stat-extended
```

### Option 3: Global install from GitHub repo

After pushing to GitHub:

```bash
npm install -g git+https://github.com/<your-username>/git-diff-stat-extended.git
```

## Usage

```bash
gdsx [options]
```

### Default comparison

`HEAD~1..HEAD`

### Options

- `--base <ref>` base ref used with `--head`
- `--head <ref>` head ref used with `--base`
- `--range <revset>` explicit revset (for example `main...HEAD`)
- `--include <glob>` include glob (repeatable); for renames/copies, matches against the new path
- `--exclude <glob>` exclude glob (repeatable); for renames/copies, matches against the new path
- `--json` structured JSON output
- `--verbose` extra diagnostics/warnings

### Examples

```bash
# Default range
gdsx

# Compare branch tip against main
gdsx --base main --head HEAD

# Symmetric range expression
gdsx --range main...HEAD

# Include only src and tests
gdsx --include 'src/**' --include 'tests/**'

# Exclude generated files
gdsx --exclude '**/*.snap' --exclude 'dist/**'

# JSON output
gdsx --base main --json
```

## Output

Text mode prints:

1. git shortstat-style summary line
2. category table (implementation/tests/comments + net)
3. reconciliation line (`PASS` or `FAIL`)
4. diagnostics block on fail

JSON mode includes:

- `shortstatLine`
- `total`
- `categories`
- `reconciliation`
- `range`
- `filters`
- `selectedFiles`

## Reconciliation guarantees

`gdsx` compares computed category sums to authoritative git totals.

When mismatch occurs:

- reconciliation status is `FAIL`
- diagnostics are printed
- process exit code is non-zero

This makes the tool safe for scripting and CI checks.

## Development

```bash
npm install
npm test
npm run build
```

Tests run with Vitest in BDD style and use shared setup via `test/setup.js` configured in `vitest.config.js`.

Build output is emitted to `dist/`:

- runtime files: `dist/gdsx.js`, `dist/gdsx-cli.js`, `dist/gdsx-lib.js`, `dist/git-parse.js`, `dist/classify.js`
- generated types: `dist/gdsx-lib.d.ts`, `dist/gdsx-lib.d.ts.map`

Type declarations are generated from JSDoc using `tsc -p tsconfig.typings.json`.

## Release

The release workflow is automated via `npm run release`, which bumps the minor
version, pushes the tag, and creates a GitHub release with generated notes.

Before releasing:

1. Run `npm test` and `npm run build`
2. Verify CLI wiring: `node ./dist/gdsx.js --help`
3. Validate publish payload: `npm pack --dry-run`
4. Commit any outstanding changes

Then run:

```bash
npm run release
```

## Known limitations

- Comment classification is parser-backed for JS/TS-family files only.
- Non-JS/TS files are categorized as implementation unless they match test rules.
- For files with syntax parse failures, comment classification for that side may fall back to implementation.

## License

[MIT](LICENSE)
