'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const {
    runCommand,
    parseActiveJobs,
    parseHistoryJobs,
    filterJobsByState,
    dedupeAgainstActive,
    lintSbatch,
    isValidJobId,
    findLogPaths,
} = require('./lib/slurm.js');
const {
    getWebviewContent,
    PERIOD_LABELS,
    DEFAULT_FILTERS,
} = require('./lib/webview.js');
const {
    initCacheDir,
    readCachedPayload,
    writeCachedPayload,
} = require('./lib/cache.js');
const config = require('./lib/config.js');

// Period preset -> sacct --starttime value
const RANGE_TO_STARTTIME = {
    '24h': 'now-24hours',
    '7d': 'now-7days',
    '30d': 'now-30days',
    all: '1970-01-01',
};

const SACCT_FORMAT =
    'JobIDRaw,Partition,JobName,User,State,Elapsed,NNodes,NodeList,SubmitLine,Start,End,ExitCode,TimeLimit,WorkDir';

/** squeue args honoring the sbatch.userFilter setting ('me' or 'all'). */
function squeueArgs() {
    const base = ['--noheader', '--format=%i|%P|%j|%u|%t|%M|%D|%R|%Z|%o'];
    return config.userFilter() === 'all' ? ['-a', ...base] : ['--me', ...base];
}

/** Build sacct arguments for the requested period (filters.range). */
function buildSacctArgs(filters) {
    const args = ['--noheader', '--parsable2', `--format=${SACCT_FORMAT}`];
    const range = filters.range || DEFAULT_FILTERS.range;

    if (range === 'custom') {
        if (filters.startDate) {
            args.push(`--starttime=${filters.startDate}`);
        }
        if (filters.endDate) {
            args.push(`--endtime=${filters.endDate}`);
        }
    } else {
        args.push(
            `--starttime=${RANGE_TO_STARTTIME[range] || RANGE_TO_STARTTIME['7d']}`
        );
    }

    return args;
}

// Cached sacct result: history changes slowly, so re-query at most every
// sbatch.sacctCacheMs. The cache key includes the sacct arguments, so
// changing the period/state filters invalidates it automatically.
let sacctCache = { key: '', time: 0, result: null };

/**
 * Resolve the log/error file paths for a job id of the given script, using
 * the script's #SBATCH --output/--error directives (with %j/%J expansion)
 * and falling back to slurm-<jobid>.out/.err next to the script.
 */
function getJobLogPaths(filePath, jobId) {
    const scriptDir = path.dirname(filePath);
    let scriptText = '';
    try {
        scriptText = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        scriptText = '';
    }

    const logPaths = findLogPaths(scriptText, jobId, scriptDir);
    return {
        output:
            logPaths.output ||
            (jobId ? path.join(scriptDir, `slurm-${jobId}.out`) : ''),
        error:
            logPaths.error ||
            (jobId ? path.join(scriptDir, `slurm-${jobId}.err`) : ''),
    };
}

async function getHistoryResult(filters) {
    const args = buildSacctArgs(filters);
    const key = JSON.stringify(args);
    const now = Date.now();

    if (sacctCache.key === key && now - sacctCache.time < config.sacctCacheMs()) {
        return sacctCache.result;
    }

    const result = await runCommand(config.binary('sacct'), args, {
        timeoutMs: config.commandTimeoutMs(),
    });
    sacctCache = { key, time: now, result };
    return result;
}

/**
 * Open a log file in the editor, but only if it is a real, readable file.
 * Returns true when opened, false otherwise (and explains why).
 */
async function openLogFile(target) {
    let isFile = false;
    try {
        isFile = !!target && fs.statSync(target).isFile();
    } catch (err) {
        isFile = false;
    }

    if (isFile) {
        await vscode.window.showTextDocument(vscode.Uri.file(target));
        return true;
    }

    vscode.window.showInformationMessage(
        target
            ? `Log file not created yet (${target}) — it appears once the job starts running.`
            : 'Log file path is unknown for this submission.'
    );
    return false;
}

async function submitSlurmJob(uri) {
    // Support invocation from a keybinding: use the active sbatch editor.
    if (!uri) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'sbatch') {
            uri = editor.document.uri;
        }
    }

    if (!uri) {
        vscode.window.showErrorMessage('No file selected for submission.');
        return;
    }

    const filePath = uri.fsPath;
    const baseName = path.basename(filePath);
    const scriptDir = path.dirname(filePath);

    // Save any dirty editor for this file (active OR background tab) so the
    // lint check and the sbatch call operate on the same contents the user
    // sees, not stale disk state. Abort if the save fails.
    const dirtyDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === filePath && doc.isDirty
    );
    if (dirtyDoc) {
        const saved = await dirtyDoc.save();
        if (!saved) {
            vscode.window.showErrorMessage(
                `Could not save ${baseName} before submission; aborting.`
            );
            return;
        }
    }

    // ---- Lint the #SBATCH directives before submitting ----
    let scriptText = '';
    try {
        scriptText = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        scriptText = '';
    }
    const issues = lintSbatch(scriptText);
    if (issues.length) {
        const details = issues.map((i) => `• ${i.message}`).join('\n');
        const choice = await vscode.window.showWarningMessage(
            `SBATCH lint found ${issues.length} issue(s):\n${details}`,
            { modal: true },
            'Submit Anyway',
            'Cancel'
        );
        if (choice !== 'Submit Anyway') {
            return;
        }
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Submitting ${baseName} with sbatch…`,
        },
        // Only the submission itself is tracked, so the progress notification
        // disappears as soon as sbatch returns (it must not wrap the popups).
        () => runCommand(config.binary('sbatch'), [filePath], {
            cwd: scriptDir,
            timeoutMs: config.commandTimeoutMs(),
        })
    )
        .then(async (result) => {
            if (result.code !== 0) {
                const errMsg =
                    result.stderr || `sbatch exited with code ${result.code}.`;
                const choice = await vscode.window.showErrorMessage(
                    errMsg,
                    'View Details'
                );

                if (choice === 'View Details') {
                    const doc = await vscode.workspace.openTextDocument({
                        content: errMsg,
                        language: 'plaintext',
                    });
                    await vscode.window.showTextDocument(doc);
                }
                return;
            }

            const jobIdMatch = (result.stdout || '').match(/(\d+)/);
            const jobId = jobIdMatch ? jobIdMatch[1] : '';

            const logPaths = getJobLogPaths(filePath, jobId);
            const logPath = logPaths.output || logPaths.error;

            const choice = await vscode.window.showInformationMessage(
                result.stdout
                    ? `${baseName}: ${result.stdout}`
                    : `${baseName}: submitted successfully.`,
                'Open Log',
                'Open Folder'
            );

            if (choice === 'Open Log') {
                await openLogFile(logPath);
            } else if (choice === 'Open Folder') {
                const folderUri = vscode.Uri.file(scriptDir);
                if (vscode.workspace.getWorkspaceFolder(folderUri)) {
                    await vscode.commands.executeCommand(
                        'revealInExplorer',
                        folderUri
                    );
                } else {
                    vscode.window.showInformationMessage(
                        `Script folder: ${scriptDir}`
                    );
                }
            }
        })
        .catch((err) => {
            vscode.window.showErrorMessage(err.message);
        });
}

async function listSubmittedJobs(uri) {
    if (!uri) {
        vscode.window.showErrorMessage('No file selected.');
        return;
    }

    const filePath = uri.fsPath;
    const baseName = path.basename(filePath);

    const panel = vscode.window.createWebviewPanel(
        'slurmJobs',
        `SLURM Jobs – ${baseName}`,
        vscode.ViewColumn.Active,
        { enableScripts: true }
    );

    panel.webview.html = getWebviewContent(baseName, DEFAULT_FILTERS);

    let currentFilters = Object.assign({}, DEFAULT_FILTERS);
    let timer = null;
    let busy = false;
    let lastPayloadKey = '';

    /** Paint instantly from the persistent cache (if it matches the filters). */
    function serveCached() {
        const cached = readCachedPayload(filePath, currentFilters);
        if (cached) {
            safePost({
                type: 'jobs',
                active: cached.active,
                history: cached.history,
                message: cached.message,
                error: false,
                periodLabel: cached.periodLabel,
            });
        }
    }

    function jobsKey(jobs) {
        return jobs
            .map((j) =>
                [j.jobId, j.state, j.nnodes, j.nodelist, j.exitCode].join('|')
            )
            .sort()
            .join('\n');
    }

    function safePost(message) {
        try {
            panel.webview.postMessage(message);
        } catch (err) {
            // Panel was disposed while a query was in flight.
        }
    }

    async function tick(force) {
        if (busy) {
            return;
        }
        busy = true;

        try {
            const [activeRes, historyRes] = await Promise.all([
                runCommand(config.binary('squeue'), squeueArgs(), {
                    timeoutMs: config.commandTimeoutMs(),
                }),
                getHistoryResult(currentFilters),
            ]);

            const firstError =
                (activeRes.code !== 0 && activeRes.stderr) ||
                (historyRes.code !== 0 && historyRes.stderr);
            if (firstError) {
                throw new Error(firstError);
            }

            const activeJobs = filterJobsByState(
                parseActiveJobs(activeRes.stdout, filePath),
                currentFilters.state
            );
            const historyJobs = dedupeAgainstActive(
                activeJobs,
                filterJobsByState(
                    parseHistoryJobs(historyRes.stdout, filePath),
                    currentFilters.state
                )
            );

            // Only push a payload when something meaningful changed
            // (unless forced); elapsed time is tracked client-side.
            const key =
                jobsKey(activeJobs) + '###' + jobsKey(historyJobs);
            if (!force && key === lastPayloadKey) {
                return;
            }
            lastPayloadKey = key;

            safePost({
                type: 'jobs',
                active: activeJobs,
                history: historyJobs,
                message: '',
                error: false,
                periodLabel:
                    PERIOD_LABELS[currentFilters.range] ||
                    PERIOD_LABELS['7d'],
            });
            writeCachedPayload(filePath, currentFilters, {
                active: activeJobs,
                history: historyJobs,
                message: '',
                periodLabel:
                    PERIOD_LABELS[currentFilters.range] ||
                    PERIOD_LABELS['7d'],
            });
        } catch (err) {
            const key = 'ERR|' + err.message;
            if (!force && key === lastPayloadKey) {
                return;
            }
            lastPayloadKey = key;
            safePost({
                type: 'jobs',
                active: [],
                history: [],
                message: err.message,
                error: true,
                periodLabel: '',
            });
        } finally {
            busy = false;
        }
    }

    function startTimer() {
        if (!timer) {
            timer = setInterval(tick, config.refreshIntervalMs());
        }
    }

    function stopTimer() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    // Restart the timer when sbatch settings change (e.g. refresh interval),
    // so settings take effect without reloading the window.
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('sbatch')) {
            stopTimer();
            startTimer();
            tick();
        }
    });

    panel.onDidDispose(() => {
        stopTimer();
        configListener.dispose();
    });
    panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) {
            // The webview may have been re-created while hidden (it would
            // show its initial "Loading jobs…" state), so force a fresh
            // payload even if the data itself has not changed.
            lastPayloadKey = '';
            serveCached();
            startTimer();
            tick();
        } else {
            stopTimer();
        }
    });

    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'ready') {
            // Webview (re)loaded: paint from cache, then push fresh data.
            serveCached();
            await tick(true);
        } else if (message.type === 'refresh') {
            currentFilters = Object.assign(
                {},
                DEFAULT_FILTERS,
                message.filters || {}
            );
            sacctCache.key = ''; // force a fresh sacct query for the new range
            await tick();
        } else if (message.type === 'submit') {
            await submitSlurmJob(uri);
            await tick(); // the new job should show up right away
        } else if (message.type === 'openLog' || message.type === 'openError') {
            const jobId = message.jobId;
            if (!isValidJobId(jobId)) {
                vscode.window.showErrorMessage(`Invalid job id: ${jobId}`);
                return;
            }

            const paths = getJobLogPaths(filePath, jobId);
            const target =
                message.type === 'openLog' ? paths.output : paths.error;
            await openLogFile(target);
        } else if (message.type === 'cancel' && message.jobId) {
            const jobId = message.jobId;

            // Never pass an unvalidated job id to scancel.
            if (!isValidJobId(jobId)) {
                vscode.window.showErrorMessage(`Invalid job id: ${jobId}`);
                return;
            }
            const confirm = await vscode.window.showWarningMessage(
                `Cancel job ${jobId}?`,
                { modal: true },
                'Yes',
                'No'
            );

            if (confirm !== 'Yes') {
                return;
            }

            try {
                const res = await runCommand(config.binary('scancel'), [jobId], {
                    timeoutMs: config.commandTimeoutMs(),
                });

                if (res.code === 0) {
                    vscode.window.showInformationMessage(
                        `Job ${jobId} cancelled.`
                    );
                    await tick();
                } else {
                    vscode.window.showErrorMessage(
                        res.stderr || `Failed to cancel job ${jobId}.`
                    );
                }
            } catch (err) {
                vscode.window.showErrorMessage(err.message);
            }
        }
    });

    startTimer();
    serveCached();
    await tick();
}

function activate(context) {
    initCacheDir(context.globalStorageUri.fsPath);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sbatch.submitSlurmJob',
            submitSlurmJob
        ),
        vscode.commands.registerCommand(
            'sbatch.listSubmittedJobs',
            listSubmittedJobs
        )
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
};
