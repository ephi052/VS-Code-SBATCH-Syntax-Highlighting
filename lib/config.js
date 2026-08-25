'use strict';

const vscode = require('vscode');

/** Read an `sbatch.*` workspace setting with a fallback. */
function get(name, fallback) {
    return vscode.workspace
        .getConfiguration('sbatch')
        .get(name, fallback);
}

module.exports = {
    /** Max time (ms) a SLURM command may run before being killed. */
    commandTimeoutMs: () => get('commandTimeoutMs', 30000),
    /** Job list auto-refresh interval (ms). */
    refreshIntervalMs: () => get('refreshIntervalMs', 1000),
    /** How long sacct history results are cached (ms). */
    sacctCacheMs: () => get('sacctCacheMs', 10000),
    /** 'me' (default) or 'all' (requires cluster permission). */
    userFilter: () => get('userFilter', 'me'),
    /** Extra arguments passed to sinfo (used by live completion). */
    sinfoArgs: () => get('sinfoArgs', []),
    /** Resolve a binary override, e.g. binary('sbatch') -> sbatchPath. */
    binary: (name) => get(`${name}Path`, name),
};
