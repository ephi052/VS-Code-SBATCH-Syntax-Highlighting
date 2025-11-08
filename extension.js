const vscode = require('vscode');
const { exec } = require('child_process');
const path = require('path');

// Run a shell command and return { stdout, stderr, code }
function runCommand(cmd) {
    return new Promise((resolve) => {
        exec(cmd, { shell: '/bin/bash' }, (error, stdout, stderr) => {
            resolve({
                stdout: (stdout || '').trim(),
                stderr: (stderr || '').trim(),
                code: error ? error.code : 0,
            });
        });
    });
}

function activate(context) {
    // === Submit SLURM job via sbatch ===
    const submitDisposable = vscode.commands.registerCommand(
        'sbatch.submitSlurmJob',
        async (uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('No file selected for submission.');
                return;
            }

            const filePath = uri.fsPath;
            const safePath = filePath.replace(/"/g, '\\"');
            const cmd = `sbatch "${safePath}"`;

            const result = await runCommand(cmd);

            if (result.stdout) {
                vscode.window.showInformationMessage(result.stdout);
            } else if (result.stderr) {
                vscode.window.showErrorMessage(result.stderr);
            } else {
                vscode.window.showInformationMessage(
                    `Submitted SLURM job from: ${filePath}`
                );
            }
        }
    );

    // === List jobs for this sbatch file in a Webview (with scancel) ===
    const listJobsDisposable = vscode.commands.registerCommand(
        'sbatch.listSubmittedJobs',
        async (uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('No file selected.');
                return;
            }

            const filePath = uri.fsPath;
            const safePath = filePath.replace(/"/g, '\\"');
            const baseName = path.basename(filePath);

            const panel = vscode.window.createWebviewPanel(
                'slurmJobs',
                `SLURM Jobs – ${baseName}`,
                vscode.ViewColumn.Active,
                { enableScripts: true }
            );

            async function refresh() {
                // Active jobs: filter by %o (command) containing the sbatch path
                const activeCmd = `
FILE="${safePath}";
squeue --me --format="%i|%P|%j|%u|%t|%M|%D|%R|%o" --noheader \
| awk -F'|' -v f="$FILE" 'index($9, f) {
    print $1"|"$2"|"$3"|"$4"|"$5"|"$6"|"$7"|"$8
}'`.trim();

                // History: filter by SubmitLine containing "sbatch <file>"
                const historyCmd = `
FILE="${safePath}";
sacct --format="JobIDRaw,Partition,JobName,User,State,Elapsed,NNodes,NodeList,SubmitLine" --noheader --parsable2 \
| awk -F'|' -v f="$FILE" 'index($9, "sbatch " f) {
    print $1"|"$2"|"$3"|"$4"|"$5"|"$6"|"$7"|"$8
}'`.trim();

                const [activeRes, historyRes] = await Promise.all([
                    runCommand(activeCmd),
                    runCommand(historyCmd),
                ]);

                const activeJobs = parseJobs(activeRes.stdout, true);
                const historyJobs = parseJobs(historyRes.stdout, false);

                if (!activeJobs.length && !historyJobs.length) {
                    panel.webview.html = getWebviewContent(
                        baseName,
                        [],
                        [],
                        'No SLURM jobs found for this file.'
                    );
                } else {
                    panel.webview.html = getWebviewContent(
                        baseName,
                        activeJobs,
                        historyJobs,
                        ''
                    );
                }
            }

            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(async (message) => {
                if (message.type === 'cancel' && message.jobId) {
                    const jobId = message.jobId;

                    const confirm = await vscode.window.showWarningMessage(
                        `Cancel job ${jobId}?`,
                        { modal: true },
                        'Yes',
                        'No'
                    );

                    if (confirm !== 'Yes') {
                        return;
                    }

                    const res = await runCommand(`scancel ${jobId}`);

                    if (res.code === 0) {
                        vscode.window.showInformationMessage(
                            `Job ${jobId} cancelled.`
                        );
                        await refresh();
                    } else {
                        const msg =
                            res.stderr || `Failed to cancel job ${jobId}.`;
                        vscode.window.showErrorMessage(msg);
                    }
                }

                if (message.type === 'refresh') {
                    await refresh();
                }
            });

            // Initial load
            await refresh();
        }
    );

    context.subscriptions.push(submitDisposable, listJobsDisposable);
}

// Parse "a|b|c|..." into array of job objects
function parseJobs(stdout, isActive) {
    if (!stdout) return [];
    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [jobId, partition, jobName, user, state, elapsed, nnodes, nodelist] =
                line.split('|');
            return {
                raw: line,
                jobId: jobId || '',
                partition: partition || '',
                jobName: jobName || '',
                user: user || '',
                state: state || '',
                elapsed: elapsed || '',
                nnodes: nnodes || '',
                nodelist: nodelist || '',
                isActive: !!isActive,
            };
        });
}

// Build HTML for Webview
function getWebviewContent(baseName, activeJobs, historyJobs, message) {
    const escapeHtml = (str) =>
        (str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

    const renderRows = (jobs, clickableActive) =>
        jobs
            .map((j) => {
                const stateClass =
                    j.state.startsWith('R') || j.state === 'RUNNING'
                        ? 'state-running'
                        : j.state.startsWith('C') || j.state === 'COMPLETED'
                        ? 'state-completed'
                        : j.state
                        ? 'state-other'
                        : '';

                const attrs = [];
                if (clickableActive && j.isActive && j.jobId) {
                    attrs.push(`data-job-id="${escapeHtml(j.jobId)}"`);
                    attrs.push('data-clickable="1"');
                }

                return `
<tr class="${stateClass}" ${attrs.join(' ')}>
  <td>${escapeHtml(j.jobId)}</td>
  <td>${escapeHtml(j.partition)}</td>
  <td>${escapeHtml(j.jobName)}</td>
  <td>${escapeHtml(j.user)}</td>
  <td>${escapeHtml(j.state)}</td>
  <td>${escapeHtml(j.elapsed)}</td>
  <td>${escapeHtml(j.nnodes)}</td>
  <td>${escapeHtml(j.nodelist)}</td>
</tr>`;
            })
            .join('\n');

    const activeTable = activeJobs.length
        ? `
<h2>Active Jobs</h2>
<table>
  <thead>
    <tr>
      <th>JobID</th>
      <th>Partition</th>
      <th>JobName</th>
      <th>User</th>
      <th>State</th>
      <th>Elapsed</th>
      <th>Nodes</th>
      <th>NodeList</th>
    </tr>
  </thead>
  <tbody>
    ${renderRows(activeJobs, true)}
  </tbody>
</table>
<div class="hint">Click an active job row to cancel it.</div>
`
        : `<p class="empty">No active jobs for this file.</p>`;

    const historyTable = historyJobs.length
        ? `
<h2>Job History</h2>
<table class="readonly">
  <thead>
    <tr>
      <th>JobID</th>
      <th>Partition</th>
      <th>JobName</th>
      <th>User</th>
      <th>State</th>
      <th>Elapsed</th>
      <th>Nodes</th>
      <th>NodeList</th>
    </tr>
  </thead>
  <tbody>
    ${renderRows(historyJobs, false)}
  </tbody>
</table>
<div class="hint readonly-hint">History rows are read-only.</div>
`
        : `<p class="empty">No past jobs for this file.</p>`;

    const infoMsg = message
        ? `<p class="message">${escapeHtml(message)}</p>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>SLURM Jobs – ${escapeHtml(baseName)}</title>
<style>
    body {
        font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        padding: 12px 16px 20px;
        color: #e5e5e5;
        background-color: #1e1e1e;
    }
    h1 {
        font-size: 18px;
        margin-bottom: 4px;
    }
    h2 {
        font-size: 14px;
        margin: 16px 0 4px;
        color: #9cdcfe;
    }
    p.empty {
        margin: 4px 0 12px;
        color: #888;
    }
    p.message {
        margin: 8px 0;
        color: #ffcc66;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 6px;
        font-size: 12px;
    }
    thead {
        background-color: #252526;
    }
    th, td {
        padding: 4px 6px;
        border-bottom: 1px solid #333;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
    }
    tr[data-clickable="1"]:hover {
        background-color: #2a2d2e;
        cursor: pointer;
    }
    table.readonly tr:hover {
        background-color: #252526;
        cursor: default;
    }
    .state-running td {
        color: #b5f38c;
    }
    .state-completed td {
        color: #8ccea3;
    }
    .state-other td {
        color: #ffcc66;
    }
    .hint {
        font-size: 11px;
        color: #777;
        margin-bottom: 4px;
    }
    .readonly-hint {
        opacity: 0.8;
    }
    .toolbar {
        display: flex;
        gap: 8px;
        margin: 4px 0 8px;
        font-size: 11px;
    }
    .btn {
        padding: 2px 8px;
        border-radius: 3px;
        border: 1px solid #3a3a3a;
        background: #2a2a2a;
        color: #ccc;
        cursor: pointer;
    }
    .btn:hover {
        background: #333;
    }
</style>
</head>
<body>
<h1>SLURM Jobs for <code>${escapeHtml(baseName)}</code></h1>
<div class="toolbar">
    <button class="btn" id="refreshBtn">Refresh</button>
</div>
${infoMsg}
${activeTable}
${historyTable}
<script>
    const vscode = acquireVsCodeApi();

    // Clickable only for active rows (data-clickable="1")
    document.querySelectorAll('tr[data-clickable="1"]').forEach(tr => {
        tr.addEventListener('click', () => {
            const jobId = tr.getAttribute('data-job-id');
            if (jobId) {
                vscode.postMessage({ type: 'cancel', jobId });
            }
        });
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh' });
    });
</script>
</body>
</html>`;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
};
