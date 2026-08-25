# SBATCH Extension — Developer Quickstart

Everything you need to build, run, and test this extension in development.

## Structure

- `package.json` — manifest: language, grammar, commands, keybinding, activation
- `syntaxes/sbatch.tmLanguage.json` — TextMate grammar (seven semantic categories, option-aware values)
- `language-configuration.json` — `#` line comment, brackets, auto-closing pairs
- `extension.js` — commands: submit, list jobs (webview), Shift+Enter
- `lib/` — `slurm.js` (spawn runner, parsers, lint, validation), `webview.js` (live job list), `cache.js` (per-file cache)
- `test/` — unit tests (node:test); run with `npm test`

## Run it

1. `npm install`
2. Open the repo folder and press `F5` (Extension Development Host)
3. Open `sample.sbatch` to see the highlighting; right-click → **Submit a SLURM Job** / **List Submitted Jobs**

## Checks & release

- `npm test` (44 tests) · `npm run lint` · `npm run package` → `sbatch-<version>.vsix`
- CI runs `lint` + `test` on every PR (`.github/workflows/ci.yml`); `main` is protected (PRs only)
- Publish to the Marketplace: `vsce publish` (publisher token required)

See README.md for usage and CHANGELOG.md for history.
