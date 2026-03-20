# Development

## Installation

```bash
git clone https://github.com/ioncache/git-diff-stat-extended.git
cd git-diff-stat-extended
npm install
npm run build
npm link
```

After making source changes, rebuild before running:

```bash
npm run build
```

## Testing

```bash
npm test
```

Tests run with Vitest in BDD style and use shared setup via `test/setup.js`
configured in `vitest.config.js`.

## Build output

Build output is emitted to `dist/`:

- runtime files: `dist/gdsx.js`, `dist/gdsx-cli.js`, `dist/gdsx-render.js`,
  `dist/gdsx-lib.js`, `dist/git-parse.js`, `dist/classify.js`
- generated types: `dist/gdsx-lib.d.ts`, `dist/gdsx-lib.d.ts.map`

Type declarations are generated from JSDoc using `tsc -p tsconfig.typings.json`.

## Release

The release workflow is automated via `npm run release`, which bumps the
version, generates release notes from Conventional Commits, pushes the tag, and
creates a GitHub release.

This project uses [Conventional Commits](https://www.conventionalcommits.org/)
for commit messages. A `commit-msg` hook enforces the format via commitlint.

Common prefixes:

- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance (deps, config, CI)
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `feat!:` or `BREAKING CHANGE:` footer — breaking change

Before releasing:

1. Run `npm test` and `npm run build`
2. Verify CLI wiring: `node ./dist/gdsx.js --help`
3. Validate publish payload: `npm pack --dry-run`
4. Commit any outstanding changes

Then run:

```bash
npm run release -- --bump minor
```

Replace `minor` with `major` or `patch` as appropriate.

To preview release notes without publishing:

```bash
npm run release -- --bump minor --dry-run
```
