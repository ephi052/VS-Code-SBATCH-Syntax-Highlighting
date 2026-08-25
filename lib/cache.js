'use strict';

const fs = require('fs');
const path = require('path');

// Best-effort persistent cache of the last job-list payload, stored in the
// extension's globalStorage. Reopening the job list can then paint instantly
// from cache while a fresh squeue/sacct query runs in the background.
let cacheDir = '';

function initCacheDir(dir) {
    cacheDir = dir;
}

function cacheFilePath() {
    return path.join(cacheDir, 'job-list-cache.json');
}

function filterKey(scope, filters) {
    return JSON.stringify({ scope: scope || '', filters: filters || {} });
}

/**
 * Read the cached payload, but only if it belongs to the same script AND
 * matches the requested filters (a cached "All time" listing for one file
 * must never be shown for another file or a "Last 24 hours" view).
 */
function readCachedPayload(scope, filters) {
    if (!cacheDir) {
        return null;
    }
    try {
        const data = JSON.parse(fs.readFileSync(cacheFilePath(), 'utf8'));
        if (data && filterKey(data.scope, data.filters) === filterKey(scope, filters)) {
            return {
                active: data.active || [],
                history: data.history || [],
                message: data.message || '',
                periodLabel: data.periodLabel || '',
                savedAt: data.savedAt || 0,
            };
        }
    } catch (err) {
        // missing or corrupt cache: fall through to a live query
    }
    return null;
}

function writeCachedPayload(scope, filters, payload) {
    if (!cacheDir) {
        return;
    }
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
        const data = Object.assign({}, payload, {
            scope,
            filters,
            savedAt: Date.now(),
        });
        fs.writeFileSync(cacheFilePath(), JSON.stringify(data));
    } catch (err) {
        // the cache is best-effort; never fail the job list for it
    }
}

module.exports = {
    initCacheDir,
    readCachedPayload,
    writeCachedPayload,
};
