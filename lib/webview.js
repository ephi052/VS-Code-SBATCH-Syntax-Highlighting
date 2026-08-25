'use strict';

const { escapeHtml, getNonce } = require('./slurm.js');

const PERIOD_LABELS = {
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    all: 'All time',
    custom: 'Custom range',
};

const DEFAULT_FILTERS = {
    range: '7d',
    startDate: '',
    endDate: '',
    state: 'ALL',
};

const STATE_OPTIONS = [
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'TIMEOUT',
    'OUT_OF_MEMORY',
    'PREEMPTED',
    'NODE_FAIL',
    'RUNNING',
    'PENDING',
];

/** Render `<option>` with `selected` when it matches the current value. */
function sel(value, current) {
    return value === current ? ' selected' : '';
}

/**
 * Static page scaffold + client-side render script.
 *
 * The extension queries SLURM on an interval and pushes job data via
 * postMessage({ type: 'jobs', active, history, message, error, periodLabel });
 * the webview merges active + history into a single table and updates rows
 * in place, so scroll position, sort order and the search box keep working
 * while auto-refreshing every second. Styling follows the active VS Code
 * theme through --vscode-* CSS variables.
 */
function getWebviewContent(baseName, filters) {
    const nonce = getNonce();
    const f = Object.assign({}, DEFAULT_FILTERS, filters || {});
    const periodLabel = PERIOD_LABELS[f.range] || PERIOD_LABELS['7d'];
    const showCustom = f.range === 'custom';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>SLURM Jobs – ${escapeHtml(baseName)}</title>
<style>
    /* ---- theme-aware palette (follows the active VS Code theme) ---- */
    :root {
        --bg: var(--vscode-editor-background, #1e1e1e);
        --text: var(--vscode-foreground, #e5e5e5);
        --muted: var(--vscode-descriptionForeground, #888);
        --panel: var(--vscode-editorWidget-background, #252526);
        --border: var(--vscode-widget-border, #454545);
        --input-bg: var(--vscode-input-background, #2a2a2a);
        --input-fg: var(--vscode-input-foreground, #e5e5e5);
        --input-border: var(--vscode-input-border, #3a3a3a);
        --btn-bg: var(--vscode-button-secondaryBackground, #2a2a2a);
        --btn-fg: var(--vscode-button-secondaryForeground, #ccc);
        --btn-hover: var(--vscode-button-secondaryHoverBackground, #333);
        --link: var(--vscode-textLink-foreground, #9cdcfe);
        --hover: var(--vscode-list-hoverBackground, #2a2d2e);
        --header-bg: var(--vscode-sideBarSectionHeader-background, #2d2d30);
        --focus: var(--vscode-focusBorder, #007fd4);
        --code-bg: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.15));
        --chart-green: var(--vscode-charts-green, #89d185);
        --chart-red: var(--vscode-charts-red, #f48771);
        --chart-yellow: var(--vscode-charts-yellow, #d7ba7d);
        --chart-orange: var(--vscode-charts-orange, #d18616);
        --chart-blue: var(--vscode-charts-blue, #75beff);
        --chart-purple: var(--vscode-charts-purple, #b180d7);
        --error-bg: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        --error-border: var(--vscode-inputValidation-errorBorder, #be1100);
        --error-fg: var(--vscode-inputValidation-errorForeground, #ffcc66);
    }
    body.vscode-light { color-scheme: light; }
    body.vscode-dark { color-scheme: dark; }
    body.vscode-high-contrast { color-scheme: dark; }

    * { box-sizing: border-box; }
    body {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, system-ui, sans-serif);
        padding: 12px 16px 20px;
        color: var(--text);
        background-color: var(--bg);
        font-size: 13px;
    }
    h1 { font-size: 18px; margin: 0; }
    /* Header row: title on the left, summary chips on the right */
    .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 4px;
    }
    h2 {
        font-size: 14px;
        margin: 20px 0 6px;
        color: var(--link);
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .sec-count { font-size: 11px; font-weight: normal; color: var(--muted); }
    code { background: var(--code-bg); padding: 0 4px; border-radius: 3px; }

    /* Control bar (filters + search in one panel) */
    .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--panel);
        margin: 8px 0 4px;
    }
    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        font-size: 12px;
    }
    .controls-right {
        display: flex;
        gap: 6px;
        align-items: center;
        margin-left: auto;
    }
    .filters label { display: flex; align-items: center; gap: 4px; color: var(--text); }
    .filters select, .filters input {
        background: var(--input-bg);
        color: var(--input-fg);
        border: 1px solid var(--input-border);
        border-radius: 3px;
        padding: 2px 6px;
        font-size: 12px;
    }
    .filters select:focus, .filters input:focus {
        outline: none;
        border-color: var(--focus);
    }
    .filters input[type="date"] { color-scheme: light dark; }
    .hidden { display: none !important; }
    .hint { font-size: 11px; color: var(--muted); }

    /* Search */
    .search-box {
        flex: 1 1 160px;
        min-width: 160px;
        max-width: 260px;
        padding: 4px 8px;
        background: var(--input-bg);
        color: var(--input-fg);
        border: 1px solid var(--input-border);
        border-radius: 3px;
        font-size: 12px;
    }
    .search-box:focus { outline: none; border-color: var(--focus); }

    /* Footer hint */
    .footer-hint { margin: 10px 0 0; text-align: right; }

    /* Summary chips */
    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0;
        justify-content: flex-end;
    }
    .chip {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        border: 1px solid var(--input-border);
        background: var(--input-bg);
        color: var(--text);
    }
    .chip b { font-weight: 600; }

    /* Messages */
    p.message {
        margin: 8px 0;
        padding: 8px 10px;
        border-radius: 4px;
        color: var(--muted);
    }
    p.message.error {
        border: 1px solid var(--error-border);
        background: var(--error-bg);
        color: var(--error-fg);
        white-space: pre-wrap;
    }
    p.empty { margin: 4px 0 12px; color: var(--muted); }

    /* Tables */
    .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead th {
        position: sticky;
        top: 0;
        background: var(--header-bg);
        color: var(--text);
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid var(--border);
        white-space: nowrap;
        user-select: none;
        cursor: pointer;
        font-weight: 600;
    }
    thead th:hover { background: var(--hover); }
    thead th.no-sort { cursor: default; }
    thead th.sorted-asc::after { content: ' ▴'; color: var(--link); }
    thead th.sorted-desc::after { content: ' ▾'; color: var(--link); }
    tbody td {
        padding: 5px 8px;
        border-bottom: 1px solid rgba(128, 128, 128, 0.15);
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
        max-width: 220px;
    }
    tbody tr:nth-child(even) { background: rgba(128, 128, 128, 0.06); }
    tbody tr:hover { background: var(--hover); }
    tbody tr[data-clickable="1"] { cursor: pointer; }
    tbody tr[data-clickable="1"]:hover { background: var(--hover); }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }

    /* Row action buttons (open log / error) */
    td.row-actions { white-space: nowrap; }
    .mini-btn {
        font-size: 10px;
        padding: 1px 6px;
        margin: 0 2px;
        border-radius: 3px;
        border: 1px solid var(--input-border);
        background: var(--btn-bg);
        color: var(--btn-fg);
        cursor: pointer;
        font-family: inherit;
    }
    .mini-btn:hover { background: var(--btn-hover); }

    /* State + source pills (colors follow the theme's chart palette) */
    .pill {
        display: inline-block;
        font-size: 10.5px;
        font-weight: 600;
        padding: 1px 7px;
        border-radius: 8px;
        letter-spacing: 0.3px;
        border: 1px solid rgba(128, 128, 128, 0.3);
        background: rgba(128, 128, 128, 0.08);
        color: var(--muted);
    }
    .pill-running { color: var(--chart-green); }
    .pill-pending { color: var(--chart-yellow); }
    .pill-completed { color: var(--chart-blue); }
    .pill-failed { color: var(--chart-red); }
    .pill-cancelled { color: var(--chart-orange); }
    .pill-timeout { color: var(--chart-red); }
    .pill-oom { color: var(--chart-purple); }
    .pill-other { color: var(--muted); }
    .pill-source-active { color: var(--chart-green); }
    .pill-source-history { color: var(--muted); }
</style>
</head>
<body>
<div class="page-header">
    <h1>SLURM Jobs for <code>${escapeHtml(baseName)}</code></h1>
    <div class="chips" id="chips" style="display:none"></div>
</div>

<div class="controls">
    <div class="filters">
        <label>Period
            <select id="rangeSel">
                <option value="24h"${sel('24h', f.range)}>Last 24 hours</option>
                <option value="7d"${sel('7d', f.range)}>Last 7 days</option>
                <option value="30d"${sel('30d', f.range)}>Last 30 days</option>
                <option value="all"${sel('all', f.range)}>All time</option>
                <option value="custom"${sel('custom', f.range)}>Custom…</option>
            </select>
        </label>
        <label class="custom-range${showCustom ? '' : ' hidden'}">From
            <input type="date" id="startDate" value="${escapeHtml(f.startDate)}" />
        </label>
        <label class="custom-range${showCustom ? '' : ' hidden'}">To
            <input type="date" id="endDate" value="${escapeHtml(f.endDate)}" />
        </label>
        <label>State
            <select id="stateSel">
                <option value="ALL"${sel('ALL', f.state)}>All states</option>
                ${STATE_OPTIONS.map(
                    (s) => `<option${sel(s, f.state)}>${s}</option>`
                ).join('')}
            </select>
        </label>
    </div>
    <div class="controls-right">
        <input type="search" class="search-box" id="searchBox" placeholder="Filter rows…" />
    </div>
</div>

<p class="message" id="message">Loading jobs…</p>

<section id="jobsSection">
    <h2 id="jobsHeading" class="hidden">Jobs — <span id="periodLabel">${escapeHtml(periodLabel)}</span> <span class="sec-count" id="jobsCount"></span></h2>
    <div class="table-wrap hidden" id="jobsTableWrap">
        <table>
            <thead>
                <tr>
                    <th data-sort="source">Source</th>
                    <th data-sort="jobid">JobID</th>
                    <th data-sort="partition">Partition</th>
                    <th data-sort="jobname">JobName</th>
                    <th data-sort="user">User</th>
                    <th data-sort="state">State</th>
                    <th data-sort="elapsed">Elapsed</th>
                    <th data-sort="nodes">Nodes</th>
                    <th data-sort="nodelist">NodeList</th>
                    <th data-sort="start">Start</th>
                    <th data-sort="end">End</th>
                    <th data-sort="exit">ExitCode</th>
                    <th data-sort="timelimit">TimeLimit</th>
                    <th class="no-sort">Logs</th>
                </tr>
            </thead>
            <tbody id="jobsTbody"></tbody>
        </table>
    </div>
    <p class="empty hidden" id="jobsEmpty">No jobs found for this file with the current filters.</p>
</section>

<p class="hint footer-hint">Auto-refresh: 1s · Shift+Enter: submit this file · click an active row to cancel · log/err buttons open job output · filters apply automatically.</p>
<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let query = '';
    // Default view: newest jobs first (JobID descending).
    let sort = { key: 'jobid', dir: 'desc' };
    let lastKeys = '';

    // ---------- helpers ----------
    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function pillClass(state) {
        const s = String(state || '').toUpperCase();
        if (s === 'R' || s.startsWith('RUN')) return 'pill-running';
        if (s === 'PD' || s.startsWith('PEND')) return 'pill-pending';
        if (s === 'CA' || s.startsWith('CANC')) return 'pill-cancelled';
        if (s === 'CG' || s.startsWith('COMPL')) return 'pill-completed';
        if (s === 'F' || s.startsWith('FAIL')) return 'pill-failed';
        if (s === 'TO' || s.startsWith('TIMEOUT')) return 'pill-timeout';
        if (s === 'OOM' || s.startsWith('OUT_OF_MEM')) return 'pill-oom';
        return 'pill-other';
    }

    function elapsedBase(t) {
        if (!t) return 0;
        const s = String(t);
        const day = s.match(/^(\\d+)-(\\d+):(\\d+):(\\d+)$/);
        if (day) return (+day[1]) * 86400 + (+day[2]) * 3600 + (+day[3]) * 60 + (+day[4]);
        let total = 0;
        s.split(':').forEach(function (p) { total = total * 60 + (+p || 0); });
        return total;
    }

    function fmtElapsed(total) {
        if (!total || total < 0) return '00:00:00';
        const d = Math.floor(total / 86400);
        const h = Math.floor((total % 86400) / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const pad = function (n) { return (n < 10 ? '0' : '') + n; };
        return d > 0
            ? d + '-' + pad(h) + ':' + pad(m) + ':' + pad(s)
            : pad(h) + ':' + pad(m) + ':' + pad(s);
    }

    function statePill(state) {
        return '<span class="pill ' + pillClass(state) + '">' + escapeHtml(state || '—') + '</span>';
    }

    // squeue reports short state codes; map them to full names for display.
    const SHORT_STATE_LABELS = {
        'R': 'RUNNING', 'PD': 'PENDING', 'CG': 'COMPLETING',
        'CA': 'CANCELLED', 'CD': 'COMPLETED', 'CF': 'CONFIGURING',
        'F': 'FAILED', 'NF': 'NODE_FAIL', 'TO': 'TIMEOUT',
        'OOM': 'OUT_OF_MEMORY', 'S': 'SUSPENDED', 'PR': 'PREEMPTED',
        'RV': 'REVOKED', 'SI': 'SIGNALING', 'SE': 'SPECIAL_EXIT',
        'ST': 'STOPPED', 'BF': 'BOOT_FAIL', 'DL': 'DEADLINE'
    };

    function displayState(state) {
        const s = String(state || '');
        return SHORT_STATE_LABELS[s] || s;
    }

    // ---------- row building ----------
    function buildRow(j, source) {
        const tr = document.createElement('tr');
        const disp = displayState(j.state);

        const sortPairs = [
            ['source', source],
            ['jobid', j.jobId], ['partition', j.partition], ['jobname', j.jobName],
            ['user', j.user], ['state', disp], ['elapsed', elapsedBase(j.elapsed)],
            ['nodes', j.nnodes], ['nodelist', j.nodelist],
            ['start', j.start], ['end', j.end],
            ['exit', j.exitCode], ['timelimit', j.timeLimit]
        ];
        sortPairs.forEach(function (kv) {
            tr.setAttribute('data-sort-' + kv[0], kv[1] == null ? '' : String(kv[1]));
        });
        tr.setAttribute('data-search', [
            source, j.jobId, j.partition, j.jobName, j.user, disp,
            j.nodelist, j.start, j.end, j.exitCode, j.timeLimit
        ].join(' ').toLowerCase());

        const clickable = source === 'active' && j.jobId;
        if (clickable) {
            tr.setAttribute('data-clickable', '1');
            tr.setAttribute('data-job-id', j.jobId);
            tr.addEventListener('click', function () {
                vscode.postMessage({ type: 'cancel', jobId: j.jobId });
            });
        }

        const live = source === 'active' && /^(R|CG|RUN|COMPL)/.test(String(j.state || '').toUpperCase());
        const elapsedCell = live
            ? '<td class="num" data-elapsed="' + elapsedBase(j.elapsed) + '">' + escapeHtml(j.elapsed) + '</td>'
            : '<td class="num">' + escapeHtml(j.elapsed) + '</td>';

        const srcCls = source === 'active' ? 'pill-source-active' : 'pill-source-history';
        let cells = '<td><span class="pill ' + srcCls + '">' + source + '</span></td>'
            + '<td class="num">' + escapeHtml(j.jobId) + '</td>'
            + '<td>' + escapeHtml(j.partition) + '</td>'
            + '<td>' + escapeHtml(j.jobName) + '</td>'
            + '<td>' + escapeHtml(j.user) + '</td>'
            + '<td>' + statePill(disp) + '</td>'
            + elapsedCell
            + '<td class="num">' + escapeHtml(j.nnodes) + '</td>'
            + '<td>' + escapeHtml(j.nodelist) + '</td>'
            + '<td>' + escapeHtml(j.start) + '</td>'
            + '<td>' + escapeHtml(j.end) + '</td>'
            + '<td class="num">' + escapeHtml(j.exitCode) + '</td>'
            + '<td>' + escapeHtml(j.timeLimit) + '</td>'
            + '<td class="row-actions">'
            + '<button class="mini-btn" title="Open stdout log">log</button>'
            + '<button class="mini-btn" title="Open stderr log">err</button>'
            + '</td>';
        tr.innerHTML = cells;

        // log/err buttons: open the job's output files without triggering
        // the row's click-to-cancel behaviour.
        const logBtn = tr.querySelector('.mini-btn[title="Open stdout log"]');
        const errBtn = tr.querySelector('.mini-btn[title="Open stderr log"]');
        logBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            vscode.postMessage({ type: 'openLog', jobId: j.jobId });
        });
        errBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            vscode.postMessage({ type: 'openError', jobId: j.jobId });
        });

        return tr;
    }

    function rowKeys(jobs) {
        return jobs.map(function (j) {
            return [j.source, j.jobId, j.state, j.nnodes, j.nodelist, j.exitCode].join('|');
        }).join('\\n');
    }

    // ---------- rendering ----------
    function fillTable(jobs) {
        const heading = document.getElementById('jobsHeading');
        const wrap = document.getElementById('jobsTableWrap');
        const empty = document.getElementById('jobsEmpty');
        const count = document.getElementById('jobsCount');

        if (!jobs.length) {
            heading.classList.add('hidden');
            wrap.classList.add('hidden');
            empty.classList.remove('hidden');
            count.textContent = '';
            return;
        }

        heading.classList.remove('hidden');
        wrap.classList.remove('hidden');
        empty.classList.add('hidden');
        count.textContent = '(' + jobs.length + ')';

        const tbody = document.getElementById('jobsTbody');
        tbody.innerHTML = '';
        const frag = document.createDocumentFragment();
        jobs.forEach(function (j) { frag.appendChild(buildRow(j, j.source)); });
        tbody.appendChild(frag);

        applySort();
        applySearch();
    }

    function summarize(jobs) {
        const c = { total: jobs.length, running: 0, pending: 0, completed: 0, cancelled: 0, failed: 0, timeout: 0, oom: 0, other: 0 };
        jobs.forEach(function (j) {
            const s = String(j.state || '').toUpperCase();
            if (s === 'R' || s.startsWith('RUN')) c.running++;
            else if (s === 'PD' || s.startsWith('PEND')) c.pending++;
            else if (s === 'CA' || s.startsWith('CANC')) c.cancelled++;
            else if (s === 'CG' || s.startsWith('COMPL')) c.completed++;
            else if (s === 'F' || s.startsWith('FAIL')) c.failed++;
            else if (s === 'TO' || s.startsWith('TIMEOUT')) c.timeout++;
            else if (s === 'OOM' || s.startsWith('OUT_OF_MEM')) c.oom++;
            else c.other++;
        });
        return c;
    }

    function renderChips(c) {
        const el = document.getElementById('chips');
        const items = [
            ['Total', c.total, 'chip-total'], ['Running', c.running, 'chip-running'],
            ['Pending', c.pending, 'chip-pending'], ['Completed', c.completed, 'chip-completed'],
            ['Failed', c.failed, 'chip-failed'], ['Cancelled', c.cancelled, 'chip-cancelled'],
            ['Timed out', c.timeout, 'chip-timeout'], ['OOM', c.oom, 'chip-oom'],
            ['Other', c.other, 'chip-other']
        ];
        let html = '';
        items.forEach(function (it) {
            if (it[1] > 0) html += '<span class="chip ' + it[2] + '">' + it[0] + ': <b>' + it[1] + '</b></span>';
        });
        el.innerHTML = html;
        el.style.display = html ? '' : 'none';
    }

    function render(data) {
        const msg = document.getElementById('message');
        if (data.message) {
            msg.textContent = data.message;
            msg.classList.toggle('error', !!data.error);
            msg.classList.remove('hidden');
        } else {
            msg.classList.add('hidden');
        }

        document.getElementById('periodLabel').textContent = data.periodLabel || '';

        const all = data.active
            .map(function (j) { return Object.assign({ source: 'active' }, j); })
            .concat(data.history.map(function (j) { return Object.assign({ source: 'history' }, j); }));

        renderChips(summarize(all));

        const keys = rowKeys(all);
        if (keys !== lastKeys) {
            fillTable(all);
            lastKeys = keys;
        }
    }

    // ---------- sort & search ----------
    function applySort() {
        if (!sort) return;
        const tbody = document.getElementById('jobsTbody');
        const rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        rows.sort(function (a, b) {
            const av = a.getAttribute('data-sort-' + sort.key) || '';
            const bv = b.getAttribute('data-sort-' + sort.key) || '';
            const cmp = (/^-?\\d+$/.test(av) && /^-?\\d+$/.test(bv))
                ? (Number(av) - Number(bv))
                : String(av).localeCompare(String(bv));
            return cmp * (sort.dir === 'desc' ? -1 : 1);
        });
        rows.forEach(function (r) { tbody.appendChild(r); });

        const table = tbody.closest('table');
        table.querySelectorAll('th[data-sort]').forEach(function (h) {
            h.classList.remove('sorted-asc', 'sorted-desc');
            if (h.getAttribute('data-sort') === sort.key) {
                h.classList.add(sort.dir === 'desc' ? 'sorted-desc' : 'sorted-asc');
            }
        });
    }

    function applySearch() {
        const tbody = document.getElementById('jobsTbody');
        const count = document.getElementById('jobsCount');
        const rows = tbody.querySelectorAll('tr');
        let visible = 0;
        rows.forEach(function (tr) {
            const hit = !query || (tr.getAttribute('data-search') || '').indexOf(query) !== -1;
            tr.style.display = hit ? '' : 'none';
            if (hit) visible++;
        });
        if (count) {
            count.textContent = visible === rows.length
                ? '(' + rows.length + ')'
                : '(' + visible + ' / ' + rows.length + ' shown)';
        }
    }

    // ---------- events ----------
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
            const key = th.getAttribute('data-sort');
            const dir = (sort && sort.key === key && sort.dir === 'asc') ? 'desc' : 'asc';
            sort = { key: key, dir: dir };
            applySort();
            applySearch();
        });
    });

    const searchBox = document.getElementById('searchBox');
    searchBox.addEventListener('input', function () {
        query = searchBox.value.trim().toLowerCase();
        applySearch();
    });

    function readFilters() {
        return {
            range: document.getElementById('rangeSel').value,
            startDate: document.getElementById('startDate').value,
            endDate: document.getElementById('endDate').value,
            state: document.getElementById('stateSel').value
        };
    }

    function notify() {
        vscode.postMessage({ type: 'refresh', filters: readFilters() });
    }

    function toggleCustomRange() {
        const custom = document.getElementById('rangeSel').value === 'custom';
        document.querySelectorAll('.custom-range').forEach(function (el) {
            el.classList.toggle('hidden', !custom);
        });
    }

    document.getElementById('rangeSel').addEventListener('change', function () {
        toggleCustomRange();
        notify();
    });
    document.getElementById('stateSel').addEventListener('change', notify);
    document.getElementById('startDate').addEventListener('change', notify);
    document.getElementById('endDate').addEventListener('change', notify);

    // Shift+Enter anywhere in the panel submits the current .sbatch file
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            vscode.postMessage({ type: 'submit' });
        }
    });

    // ---------- incoming job data (1s auto-refresh) ----------
    window.addEventListener('message', function (event) {
        const data = event.data;
        if (data && data.type === 'jobs') {
            render(data);
        }
    });

    // Tell the extension we are (re)loaded so it pushes data immediately -
    // this fixes the stuck "Loading jobs…" state when the panel is re-created
    // after being hidden.
    vscode.postMessage({ type: 'ready' });

    // ---------- live elapsed ticker (active running rows only) ----------
    setInterval(function () {
        document.querySelectorAll('#jobsTbody td[data-elapsed]').forEach(function (td) {
            const secs = parseInt(td.getAttribute('data-elapsed'), 10) + 1;
            td.setAttribute('data-elapsed', String(secs));
            td.textContent = fmtElapsed(secs);
        });
    }, 1000);
</script>
</body>
</html>`;
}

module.exports = {
    getWebviewContent,
    PERIOD_LABELS,
    DEFAULT_FILTERS,
};
