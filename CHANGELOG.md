# Changelog

All notable changes to this project will be documented in this file.

## [0.0.3] - 2026-08-12
### Fixed
- **Cache scoped per script**: the job-list cache key now includes the script path, so opening a different `.sbatch` file can never briefly show (or allow cancelling) the previous file's jobs.
- **Strict script matching**: job attribution now uses token-boundary matching (exact path, bare/relative/quoted basename). `run.sbatch.backup` and same-named scripts in other directories no longer produce false positives.
- **WorkDir-aware matching**: `squeue` now requests `%Z` (WorkDir) and `sacct` includes the `WorkDir` field, so relative submissions (`sbatch run.sbatch`) are resolved against the job's actual working directory instead of being matched by basename alone.
- **State filters**: `squeue` short states (`R`, `PD`, …) are normalized to full names at parse time, so the RUNNING/PENDING filters no longer hide active jobs.
- **Save before submit**: the active editor is saved before linting/submitting, so unsaved edits (e.g. resource limits) are no longer silently omitted by Shift+Enter or right-click submit.
- **Save-all dirty tabs before submit**: any dirty editor for the target file (active or background tab, including Explorer/webview submits) is saved first, and submission aborts if the save fails.
- **Security**: Replaced shell-based `exec()` with argument-array `spawn()` for `sbatch`, `squeue`, `sacct`, and `scancel`. File names with spaces or shell metacharacters can no longer lead to command injection.
- **Comment toggling**: `language-configuration.json` now uses `#` as the line comment (previously `//`), so `Ctrl+/` comments lines correctly. Removed the invalid block-comment config (bash has none).
- **Log location**: jobs are now submitted with the working directory set to the `.sbatch` script's folder, so the default `slurm-<jobid>.out` log is written next to the script instead of `$HOME`.
- **Packaging**: `README.md` and `CHANGELOG.md` are included in the `.vsix` again (they were accidentally ignored).
- **Activation**: Extension now activates only for `.sbatch` files (`onLanguage:sbatch`) instead of on every VS Code startup.
- **Grammar**: Short flags (`-N`, `-n`, `-c`, …) are now highlighted like long flags; `$VAR`/`${VAR}` variables are recognized; `##SBATCH` disabled directives use a proper comment sub-scope.
- **Parsing**: Job listings now parse escaped pipe characters correctly (`sacct --parsable2`) and no longer rely on fragile `awk` shell pipelines.
- **Empty states**: the webview no longer shows a confusing "No active jobs" message while job history is displayed — sections have their own accurate messages.

### Added
- **Full accounting history**: the job webview now supports a configurable period (last 24 hours, 7 days, 30 days, all time, or a custom date range) and a state filter (COMPLETED, FAILED, CANCELLED, TIMEOUT, …).
- **Accounting columns**: history now shows Start, End, ExitCode, and TimeLimit in addition to the previous fields.
- **Job list layout**: state pills, sortable columns, row search box, summary chips (running/pending/completed/failed/…), sticky table headers, and zebra striping in the job webview.
- **Live job list**: the webview auto-refreshes every second (client-side rendering, so sorting/search/scroll are never interrupted). `squeue` is queried every second; `sacct` is cached for 10s to avoid hammering the cluster's accounting database. Active and history jobs are shown in a single merged table with a Source column.
- **Shift+Enter to submit**: pressing Shift+Enter in the job webview or in a `.sbatch` editor submits the file (new keybinding). The old Refresh button was removed (auto-refresh covers it).
- **Per-row log access**: every job row has **log**/**err** buttons that open the job's stdout/stderr file (resolved from the script's `--output`/`--error` directives).
- **Theme-aware webview**: the job list follows the active VS Code theme (light/dark/high-contrast) via `--vscode-*` CSS variables.
- **SBATCH linting before submit**: the extension checks the script's directives before submitting and prompts with **Submit Anyway** / **Cancel** when it finds problems (missing `--time`, conflicting `--mem` + `--mem-per-cpu`). Disabled `##SBATCH` lines are ignored.
- **Instant reopen**: the last job-list payload is cached to disk (per filter), so reopening the panel paints immediately from cache while a fresh query runs in the background.
- **Readable states & ordering**: squeue short state codes are displayed as full names (`R` → `RUNNING`, `PD` → `PENDING`, …), and the job table defaults to newest-first (JobID descending).

### Security
- **Job id validation**: `jobId` values received from the webview are validated against a strict pattern before being passed to `scancel` or used to build log paths (no path traversal / injection via the webview).
- **Log path checks**: log files are only opened when the resolved path exists and is a regular file; `findLogPaths` normalizes `../`-style values to paths anchored at the script directory.

### Fixed
- **Duplicate job rows**: a running job appeared twice (once from `squeue`, once from `sacct`, which includes running jobs). History now excludes jobs that are still active.
- **Stuck "Loading jobs…"**: returning to a previously opened job list no longer leaves the webview stuck on its loading state - the webview announces when it (re)loads, and the extension always pushes fresh data when the panel becomes visible again.
- **Grammar semantics**: `#SBATCH` values are now parsed into semantic tokens instead of colored wholesale — memory quantities split into number + unit (`32G`), time literals (`0-00:02:00`) get their own `constant.numeric.time.sbatch` scope, paths with placeholders split into string + `%j`/`%J`/`%A` placeholder + string (`job-%J.out`), `$SLURM_*` variables get a dedicated `variable.language.slurm.sbatch` scope (distinct from ordinary `$HOME`-style variables), GRES resources (`--gres=gpu:a100:2`) split into type / model / count scopes, disabled directives now match any number of extra `#` (`##SBATCH`, `###SBATCH`, …), and plain identifiers stay uncolored.
- **Option-aware value grammars**: values are now parsed in the context of their option — `--time`/`-t` accepts only time literals, `--mem`/`--mem-per-cpu`/`--mem-per-gpu` only number + unit quantities, `--output`/`--error`/`-o`/`-e` a filename grammar with `%` placeholders, `--nodes`/`--ntasks`/`--ntasks-per-node`/`--cpus-per-task`/`--gpus`(+`-per-node`/`-per-task`)/`-N`/`-n`/`-c` numeric counts, and `--mail-type`/`--mail-on-event` enum values. The global time/memory/path/enum rules were removed, so `--job-name=32G` and `--partition END` no longer pick up structured-value styling.
- **Invalid forms flagged**: forms SLURM rejects get `invalid.illegal.sbatch` (dangling `--`, whitespace around `=` such as `--job-name = x`).
- **Post-submission actions**: the success popup offers **Open Log** (resolves the real log path from the script's `--output`/`--error` directives, e.g. `job-%J.out`, falling back to `slurm-<jobid>.out`) and **Open Folder**; the error popup offers **View Details**.
- **Progress fix**: the "Submitting…" progress notification now disappears as soon as `sbatch` returns instead of staying visible while the result popup waits for input.
- Loading state in the job-listing webview while `squeue`/`sacct` run.
- Progress notification when submitting a job.
- Error states surfaced in the webview (e.g., missing SLURM tools).
- Content-Security-Policy (nonce-based) on the webview.
- Unit tests (`npm test`) and ESLint (`npm run lint`).
- `npm run package` script to build the `.vsix`.

### Changed
- Job history default period is now the last 7 days (was: since midnight / "last day").
- Removed the redundant `files.associations` contribution (the `.sbatch` language association is already contributed via `contributes.languages`).
- Dropped unused `typescript` and deprecated `vscode` devDependencies.

## [0.0.2] - 2025-11-08
### Added
- Language icon for `.sbatch` files without requiring an external icon theme. (Thanks @Antyos)
- New command **List Submitted Jobs from This File** to view jobs (active via `squeue` and last day of history via `sacct`) submitted from a specific `.sbatch` file.
- Interactive webview to display job details with ability to cancel active jobs by clicking on rows.

### Fixed
- Improved syntax highlighting of arguments, strings, numbers, and placeholders in SLURM directives. (Thanks @Antyos)
- Distinct highlighting for disabled `##SBATCH` lines across themes. (Thanks @Antyos)

### Removed
- Full icon theme contribution (HPC File Icons) - no longer needed since `.sbatch` files now have a built-in icon.

## [0.0.1] - 2024-11-02
### Added
- Initial release with syntax highlighting for `.sbatch` files.
- SLURM job submission command for `.sbatch` files.
- File Icon for `.sbatch` files.
- File Icons for most common file types used in HPC.
- Default Icon for unknown file types.
- Folder Icon for directories.
