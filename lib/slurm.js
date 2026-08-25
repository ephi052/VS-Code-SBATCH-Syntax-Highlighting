'use strict';

const { spawn } = require('child_process');
const path = require('path');

/**
 * Run a binary with an explicit argument array. No shell is involved,
 * so file names with spaces or shell metacharacters are safe.
 *
 * Options:
 *   - cwd: working directory for the child process (e.g. the sbatch
 *     script's folder, so SLURM writes slurm-<jobid>.out next to it).
 *   - timeoutMs: kill the child and reject if it does not exit within
 *     this many milliseconds (default 30000).
 *
 * Resolves with `{ stdout, stderr, code }` (stdout/stderr trimmed).
 * Rejects if the binary cannot be started (e.g. not installed / not in
 * PATH) or if it exceeds the timeout.
 */
const DEFAULT_TIMEOUT_MS = 30000;

function runCommand(command, args, options) {
    return new Promise((resolve, reject) => {
        const opts = options || {};
        const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
        const child = spawn(command, args, { cwd: opts.cwd });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const finish = (fn, value) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            fn(value);
        };

        const timer = setTimeout(() => {
            // Kill hard: a hung command must never leave the ticker or the
            // submit progress permanently stuck (the caller's busy flag is
            // always released via finally/then).
            child.kill('SIGKILL');
            finish(
                reject,
                new Error(`Command timed out after ${timeoutMs}ms: ${command}`)
            );
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (err) => {
            finish(
                reject,
                new Error(`Could not run "${command}": ${err.message}`)
            );
        });
        child.on('close', (code) => {
            finish(resolve, {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                code,
            });
        });
    });
}

/**
 * Split a line on a delimiter, honouring backslash escapes (used by
 * `sacct --parsable2`, which escapes special characters with `\`).
 */
function splitEscaped(line, delimiter) {
    const parts = [];
    let current = '';

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (ch === '\\' && i + 1 < line.length) {
            current += line[i + 1];
            i++;
        } else if (ch === delimiter) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }

    parts.push(current);
    return parts;
}

/**
 * squeue reports short state codes; map them to the full names used
 * everywhere else (filters, webview display, accounting).
 */
const SHORT_STATE_TO_FULL = {
    R: 'RUNNING',
    PD: 'PENDING',
    CG: 'COMPLETING',
    CA: 'CANCELLED',
    CD: 'COMPLETED',
    CF: 'CONFIGURING',
    F: 'FAILED',
    NF: 'NODE_FAIL',
    TO: 'TIMEOUT',
    OOM: 'OUT_OF_MEMORY',
    S: 'SUSPENDED',
    PR: 'PREEMPTED',
    RV: 'REVOKED',
    SI: 'SIGNALING',
    SE: 'SPECIAL_EXIT',
    ST: 'STOPPED',
    BF: 'BOOT_FAIL',
    DL: 'DEADLINE',
};

/** Map a squeue short state (e.g. "R") to its full name (e.g. "RUNNING"). */
function normalizeState(state) {
    return SHORT_STATE_TO_FULL[state] || state;
}

/** Strip './' prefixes and surrounding quotes from a command token. */
function normalizeToken(token) {
    let t = token;
    if (t.startsWith('./')) {
        t = t.slice(2);
    }
    t = t.replace(/^["']|["']$/g, '');
    return t;
}

/**
 * True when a command token refers to the given script, resolved against the
 * job's working directory when known.
 *
 * Priority:
 *   1. token is the exact (normalized) absolute path of the script;
 *   2. workDir is known: the token resolves (relatively) to the script path;
 *   3. no workDir info: legacy basename fallback (ambiguous, rare).
 */
function tokenMatches(token, filePath, workDir) {
    const t = normalizeToken(token);
    if (!t) {
        return false;
    }
    if (path.normalize(t) === path.normalize(filePath)) {
        return true;
    }
    if (workDir && workDir !== 'N/A' && workDir !== 'None assigned') {
        return (
            path.normalize(path.resolve(workDir, t)) ===
            path.normalize(filePath)
        );
    }
    return t === path.basename(filePath);
}

/**
 * True if a squeue "%o" command field refers to the given script, using the
 * job's working directory (%Z) to resolve relative commands.
 */
function commandMatches(command, filePath, workDir) {
    if (!command) {
        return false;
    }
    return command
        .split(/\s+/)
        .some((word) => tokenMatches(word, filePath, workDir));
}

/**
 * True if a sacct "SubmitLine" field looks like an `sbatch` invocation
 * of the given script, using the job's WorkDir to resolve relative paths.
 */
function submitLineMatches(submitLine, filePath, workDir) {
    if (!submitLine) {
        return false;
    }

    const words = submitLine.split(/\s+/);

    // Require a standalone `sbatch` command token (a bare `\bsbatch\b`
    // regex would also match filenames ending in ".sbatch").
    if (!words.includes('sbatch')) {
        return false;
    }

    return words.some((word) => tokenMatches(word, filePath, workDir));
}

/** Build a job object from the first 8 pipe-separated fields, plus extras. */
function jobFromParts(parts, isActive, extra) {
    const [jobId, partition, jobName, user, state, elapsed, nnodes, nodelist] =
        parts;

    return {
        raw: parts.join('|'),
        jobId: jobId || '',
        partition: partition || '',
        jobName: jobName || '',
        user: user || '',
        state: state || '',
        elapsed: elapsed || '',
        nnodes: nnodes || '',
        nodelist: nodelist || '',
        isActive: !!isActive,
        ...(extra || {}),
    };
}

/** Parse `squeue` output (format: %i|%P|%j|%u|%t|%M|%D|%R|%Z|%o) for jobs of this script. */
function parseActiveJobs(stdout, filePath) {
    if (!stdout) {
        return [];
    }

    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => splitEscaped(line, '|'))
        .filter((parts) => parts.length >= 10)
        .filter((parts) =>
            commandMatches(parts.slice(9).join('|'), filePath, parts[8])
        )
        .map((parts) => {
            const job = jobFromParts(parts, true);
            // squeue uses short codes (R, PD, ...); normalize so filters and
            // the webview always see full state names.
            job.state = normalizeState(job.state);
            return job;
        });
}

/**
 * Parse `sacct` output (--parsable2, format:
 * JobIDRaw,Partition,JobName,User,State,Elapsed,NNodes,NodeList,SubmitLine,
 * Start,End,ExitCode,TimeLimit,WorkDir) for jobs of this script. WorkDir is
 * used to resolve relative SubmitLine paths.
 */
function parseHistoryJobs(stdout, filePath) {
    if (!stdout) {
        return [];
    }

    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => splitEscaped(line, '|'))
        .filter((parts) => parts.length >= 14)
        .filter((parts) => submitLineMatches(parts[8], filePath, parts[13]))
        .map((parts) =>
            jobFromParts(parts, false, {
                start: parts[9] || '',
                end: parts[10] || '',
                exitCode: parts[11] || '',
                timeLimit: parts[12] || '',
            })
        );
}

/** Filter jobs by sacct state (e.g. "COMPLETED", "FAILED"). 'ALL' keeps everything. */
function filterJobsByState(jobs, state) {
    if (!state || state === 'ALL') {
        return jobs;
    }
    return jobs.filter((job) => normalizeState(job.state).startsWith(state));
}

/**
 * Remove history entries whose job id is still active (squeue). Without this,
 * a running job would appear twice in the merged table: once from squeue and
 * once from sacct (sacct includes currently running jobs).
 */
function dedupeAgainstActive(activeJobs, historyJobs) {
    const activeIds = new Set(activeJobs.map((job) => job.jobId));
    return historyJobs.filter((job) => !activeIds.has(job.jobId));
}

/**
 * Validate a SLURM job id coming from the webview before it is used in
 * `scancel` or in path construction. Accepts "12345", array members
 * ("12345_1") and steps ("12345.batch"). Rejects anything else.
 */
function isValidJobId(id) {
    return typeof id === 'string' && /^\d+(?:_\d+)*(?:\.\w+)?$/.test(id);
}

/**
 * Lightweight lint of the active #SBATCH directives of a script.
 * Returns [{ severity: 'error' | 'warning', message }].
 * Only single-hash `#SBATCH` lines count (disabled `##SBATCH` lines do not).
 */
function lintSbatch(scriptContent) {
    const text = scriptContent || '';
    const issues = [];

    // --time / -t: missing time limits are the most common submission mistake.
    const hasTime = /^\s*#SBATCH\s+(?:--time\b|-t\b)/m.test(text);
    if (!hasTime) {
        issues.push({
            severity: 'warning',
            message:
                'No --time limit is set. The cluster may reject the job or apply its default time limit.',
        });
    }

    // --mem and --mem-per-cpu are mutually exclusive in SLURM.
    // The negative lookahead keeps `--mem` from matching `--mem-per-cpu`.
    const hasMem = /^\s*#SBATCH\s+--mem(?!-)/m.test(text);
    const hasMemPerCpu = /^\s*#SBATCH\s+--mem-per-cpu\b/m.test(text);
    if (hasMem && hasMemPerCpu) {
        issues.push({
            severity: 'error',
            message:
                '--mem and --mem-per-cpu are mutually exclusive in SLURM; remove one of them.',
        });
    }

    return issues;
}

/**
 * Parse `--output`/`-o` and `--error`/`-e` values from the #SBATCH lines of a
 * script, expand the %j/%J/%A placeholders with the job id, and resolve
 * relative paths against scriptDir. Returns { output, error } ('' when unset).
 */
function findLogPaths(scriptContent, jobId, scriptDir) {
    const result = { output: '', error: '' };

    const DIRECTIVE_RE =
        /^\s*#SBATCH\s+(--output|-o|--error|-e)(?:\s*=\s*|\s+)(?:"([^"]*)"|(\S+))/gm;

    let match;
    while ((match = DIRECTIVE_RE.exec(scriptContent || '')) !== null) {
        const flag = match[1];
        const value = (match[2] !== undefined ? match[2] : match[3] || '').trim();
        if (!value) {
            continue;
        }

        const expanded = value
            .replace(/%[jJA]/g, jobId)
            .replace(/%%/g, '%');
        // Normalize so traversal-style values (e.g. "../logs/%j.out") resolve
        // to a clean absolute path anchored at scriptDir.
        const resolved = path.normalize(
            path.isAbsolute(expanded)
                ? expanded
                : path.join(scriptDir || '', expanded)
        );

        if (flag === '--output' || flag === '-o') {
            result.output = resolved;
        } else {
            result.error = resolved;
        }
    }

    return result;
}

/** Escape a string for safe interpolation into HTML text and attributes. */
function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Generate a per-render nonce for the webview Content-Security-Policy. */
function getNonce() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

module.exports = {
    runCommand,
    splitEscaped,
    commandMatches,
    submitLineMatches,
    jobFromParts,
    parseActiveJobs,
    parseHistoryJobs,
    filterJobsByState,
    normalizeState,
    dedupeAgainstActive,
    lintSbatch,
    isValidJobId,
    findLogPaths,
    escapeHtml,
    getNonce,
};
