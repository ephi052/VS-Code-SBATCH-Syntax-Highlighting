'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cache = require('../lib/cache.js');

test('cache is scoped per script file and per filter', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbatch-cache-test-'));
    cache.initCacheDir(dir);

    const filters = { range: '7d', startDate: '', endDate: '', state: 'ALL' };

    cache.writeCachedPayload('/a/run.sbatch', filters, {
        active: [],
        history: [{ jobId: '1', state: 'COMPLETED' }],
        message: '',
        periodLabel: 'Last 7 days',
    });

    // same script + same filters -> hit
    const hit = cache.readCachedPayload('/a/run.sbatch', filters);
    assert.ok(hit, 'same script + same filters should hit');
    assert.strictEqual(hit.history[0].jobId, '1');

    // a different script must NEVER share the cache
    assert.strictEqual(
        cache.readCachedPayload('/b/other.sbatch', filters),
        null,
        'different script must not share the cache'
    );

    // same script but different filters must not hit either
    const otherFilters = Object.assign({}, filters, { range: '30d' });
    assert.strictEqual(
        cache.readCachedPayload('/a/run.sbatch', otherFilters),
        null,
        'different filters must not hit'
    );

    fs.rmSync(dir, { recursive: true, force: true });
});
