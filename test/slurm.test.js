'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');

const {
    runCommand,
    splitEscaped,
    commandMatches,
    submitLineMatches,
    parseActiveJobs,
    parseHistoryJobs,
    filterJobsByState,
    normalizeState,
    dedupeAgainstActive,
    lintSbatch,
    isValidJobId,
    findLogPaths,
    escapeHtml,
} = require('../lib/slurm.js');
const { getWebviewContent, PERIOD_LABELS } = require('../lib/webview.js');

test('splitEscaped splits on plain pipes', () => {
    assert.deepStrictEqual(splitEscaped('a|b|c', '|'), ['a', 'b', 'c']);
});

test('splitEscaped honours backslash escapes', () => {
    assert.deepStrictEqual(splitEscaped('a\\|b|c', '|'), ['a|b', 'c']);
});

test('splitEscaped returns a single part for empty input', () => {
    assert.deepStrictEqual(splitEscaped('', '|'), ['']);
});

test('commandMatches matches the absolute path', () => {
    assert.strictEqual(
        commandMatches('/home/u/run.sbatch', '/home/u/run.sbatch'),
        true
    );
});

test('commandMatches matches bare/relative/ quoted basename submissions', () => {
    assert.strictEqual(commandMatches('run.sbatch', '/home/u/run.sbatch'), true);
    assert.strictEqual(commandMatches('./run.sbatch', '/home/u/run.sbatch'), true);
    assert.strictEqual(commandMatches('"run.sbatch"', '/home/u/run.sbatch'), true);
});

test('commandMatches rejects similar-but-different scripts', () => {
    // same basename in another directory
    assert.strictEqual(
        commandMatches('/home/u/project-b/run.sbatch', '/home/u/project-a/run.sbatch'),
        false
    );
    // filename that merely contains the script path
    assert.strictEqual(
        commandMatches('/home/u/run.sbatch.backup', '/home/u/run.sbatch'),
        false
    );
    assert.strictEqual(
        commandMatches('/tmp/other.sbatch', '/home/u/run.sbatch'),
        false
    );
});

test('commandMatches uses WorkDir to resolve relative commands', () => {
    const file = '/work/proj-a/run.sbatch';
    // submitted from the file's own directory
    assert.strictEqual(commandMatches('run.sbatch', file, '/work/proj-a'), true);
    assert.strictEqual(commandMatches('./run.sbatch', file, '/work/proj-a'), true);
    // submitted from another directory with the same basename -> must NOT match
    assert.strictEqual(commandMatches('run.sbatch', file, '/work/proj-b'), false);
    // absolute path matches regardless of WorkDir
    assert.strictEqual(commandMatches(file, file, '/work/proj-b'), true);
    // unknown WorkDir falls back to legacy basename matching
    assert.strictEqual(commandMatches('run.sbatch', file, undefined), true);
});

test('submitLineMatches uses WorkDir to resolve relative submissions', () => {
    const file = '/work/proj-a/run.sbatch';
    assert.strictEqual(
        submitLineMatches('sbatch run.sbatch', file, '/work/proj-a'),
        true
    );
    assert.strictEqual(
        submitLineMatches('sbatch run.sbatch', file, '/work/proj-b'),
        false
    );
    assert.strictEqual(
        submitLineMatches('sbatch /work/proj-a/run.sbatch', file, '/work/proj-b'),
        true
    );
});

test('commandMatches rejects empty or unrelated commands', () => {
    assert.strictEqual(commandMatches('', '/home/u/run.sbatch'), false);
    assert.strictEqual(
        commandMatches('/home/u/myjob.sh', '/home/u/run.sbatch'),
        false
    );
});

test('submitLineMatches accepts absolute and relative submissions', () => {
    assert.strictEqual(
        submitLineMatches('sbatch /home/u/run.sbatch', '/home/u/run.sbatch'),
        true
    );
    assert.strictEqual(
        submitLineMatches('sbatch run.sbatch', '/home/u/run.sbatch'),
        true
    );
    assert.strictEqual(
        submitLineMatches('sbatch --output=out.log /home/u/run.sbatch', '/home/u/run.sbatch'),
        true
    );
});

test('submitLineMatches rejects similar-but-different scripts', () => {
    assert.strictEqual(
        submitLineMatches('sbatch /home/u/run.sbatch.backup', '/home/u/run.sbatch'),
        false
    );
    assert.strictEqual(
        submitLineMatches('sbatch /home/u/project-b/run.sbatch', '/home/u/project-a/run.sbatch'),
        false
    );
});

test('submitLineMatches rejects non-sbatch lines and step rows', () => {
    assert.strictEqual(
        submitLineMatches('srun /home/u/run.sbatch', '/home/u/run.sbatch'),
        false
    );
    assert.strictEqual(submitLineMatches('', '/home/u/run.sbatch'), false);
});

test('parseActiveJobs extracts, filters, and normalizes squeue output', () => {
    const output = [
        '101|batch|my_job|alice|R|00:01:00|1|node01|/home/alice|/home/alice/run.sbatch',
        '102|batch|other|alice|PD|00:00:00|1|(priority)|/home/alice|/home/alice/other.sbatch',
        '103|batch|run|alice|R|00:02:00|1|node02|/other/dir|run.sbatch',
    ].join('\n');

    const jobs = parseActiveJobs(output, '/home/alice/run.sbatch');

    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0].jobId, '101');
    assert.strictEqual(jobs[0].state, 'RUNNING'); // short "R" normalized
    assert.strictEqual(jobs[0].isActive, true);
});

test('parseHistoryJobs extracts accounting fields and excludes step rows', () => {
    const output = [
        [
            '200',
            'batch',
            'my_job',
            'alice',
            'COMPLETED',
            '00:01:00',
            '1',
            'node01',
            'sbatch /home/alice/run.sbatch',
            '2026-08-11T10:00:00',
            '2026-08-11T10:01:00',
            '0:0',
            '00:05:00',
            '/home/alice',
        ].join('|'),
        [
            '200.batch',
            'batch',
            'my_job',
            'alice',
            'COMPLETED',
            '00:01:00',
            '1',
            'node01',
            '',
            '',
            '',
            '0:0',
            '00:05:00',
            '/home/alice',
        ].join('|'),
        [
            '201',
            'batch',
            'other',
            'alice',
            'FAILED',
            '00:00:05',
            '1',
            'node01',
            'sbatch /home/alice/other.sbatch',
            '2026-08-11T11:00:00',
            '2026-08-11T11:00:05',
            '1:1',
            '00:05:00',
            '/home/alice',
        ].join('|'),
        [
            '202',
            'batch',
            'run',
            'alice',
            'COMPLETED',
            '00:01:00',
            '1',
            'node01',
            'sbatch run.sbatch',
            '2026-08-11T12:00:00',
            '2026-08-11T12:01:00',
            '0:0',
            '00:05:00',
            '/home/alice/other_dir',
        ].join('|'),
    ].join('\n');

    const jobs = parseHistoryJobs(output, '/home/alice/run.sbatch');

    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0].jobId, '200');
    assert.strictEqual(jobs[0].state, 'COMPLETED');
    assert.strictEqual(jobs[0].start, '2026-08-11T10:00:00');
    assert.strictEqual(jobs[0].end, '2026-08-11T10:01:00');
    assert.strictEqual(jobs[0].exitCode, '0:0');
    assert.strictEqual(jobs[0].timeLimit, '00:05:00');
    assert.strictEqual(jobs[0].isActive, false);
});

test('filterJobsByState works with normalized short states', () => {
    assert.strictEqual(normalizeState('R'), 'RUNNING');
    assert.strictEqual(normalizeState('PD'), 'PENDING');
    assert.strictEqual(normalizeState('COMPLETED'), 'COMPLETED');

    // active jobs (short squeue states) must match the RUNNING/PENDING filters
    const jobs = [
        { state: 'R' },
        { state: 'PD' },
        { state: 'COMPLETED' },
        { state: 'FAILED' },
        { state: 'CANCELLED by 999' },
    ];
    assert.strictEqual(filterJobsByState(jobs, 'RUNNING').length, 1);
    assert.strictEqual(filterJobsByState(jobs, 'PENDING').length, 1);
    assert.strictEqual(filterJobsByState(jobs, 'CANCELLED').length, 1);
    assert.strictEqual(filterJobsByState(jobs, 'ALL').length, 5);
    assert.strictEqual(filterJobsByState(jobs, '').length, 5); // '' behaves like ALL
    assert.strictEqual(filterJobsByState(jobs, 'TIMEOUT').length, 0);
});

test('runCommand honours the cwd option', async () => {
    const dir = os.tmpdir();
    const res = await runCommand('pwd', [], { cwd: dir });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.stdout, dir);
});

test('runCommand rejects when the binary does not exist', async () => {
    await assert.rejects(
        runCommand('definitely-not-a-real-binary-xyz', []),
        /Could not run/
    );
});

test('runCommand rejects when the command exceeds the timeout', async () => {
    const start = Date.now();
    await assert.rejects(
        runCommand('sleep', ['10'], { timeoutMs: 200 }),
        /timed out after 200ms/
    );
    // the timeout must fire promptly, not after the sleep finishes
    assert.ok(Date.now() - start < 5000, 'timeout must fire promptly');
});

test('findLogPaths parses space and equals forms', () => {
    const script = [
        '#SBATCH --output job-%j.out',
        '#SBATCH --error=job-%j.err',
    ].join('\n');
    const logs = findLogPaths(script, '12345', '/work/dir');
    assert.strictEqual(logs.output, '/work/dir/job-12345.out');
    assert.strictEqual(logs.error, '/work/dir/job-12345.err');
});

test('findLogPaths handles quotes, short flags, absolute paths and %J', () => {
    const script = [
        '#SBATCH -o "my log %J.out"',
        '#SBATCH -e /var/log/err-%j.txt',
    ].join('\n');
    const logs = findLogPaths(script, '42', '/work/dir');
    assert.strictEqual(logs.output, '/work/dir/my log 42.out');
    assert.strictEqual(logs.error, '/var/log/err-42.txt');
});

test('findLogPaths returns empty strings when no directives are present', () => {
    const logs = findLogPaths(
        '#SBATCH --time=01:00:00\n#!/bin/bash\n',
        '1',
        '/x'
    );
    assert.deepStrictEqual(logs, { output: '', error: '' });
});

test('dedupeAgainstActive removes history rows whose job is still running', () => {
    const active = [{ jobId: '101', state: 'R' }];
    const history = [
        { jobId: '101', state: 'RUNNING' },   // same job, still active -> drop
        { jobId: '100', state: 'COMPLETED' },
        { jobId: '99', state: 'FAILED' },
    ];

    const result = dedupeAgainstActive(active, history);

    assert.strictEqual(result.length, 2);
    assert.ok(!result.some((j) => j.jobId === '101'));
    assert.deepStrictEqual(
        result.map((j) => j.jobId).sort(),
        ['100', '99']
    );
});

test('lintSbatch warns when --time is missing', () => {
    const issues = lintSbatch('#SBATCH --mem=5GB\n#!/bin/bash\n');
    assert.ok(issues.some((i) => i.severity === 'warning' && /--time/.test(i.message)));
});

test('lintSbatch accepts --time and -t, but not disabled ##SBATCH lines', () => {
    assert.strictEqual(lintSbatch('#SBATCH --time=01:00:00\n').length, 0);
    assert.strictEqual(lintSbatch('#SBATCH -t 01:00:00\n').length, 0);
    // a disabled directive does not count as setting a time limit
    assert.ok(lintSbatch('##SBATCH --time=01:00:00\n').some((i) => i.severity === 'warning'));
});

test('lintSbatch flags --mem + --mem-per-cpu conflict', () => {
    const issues = lintSbatch(
        '#SBATCH --time=00:05:00\n#SBATCH --mem=5GB\n#SBATCH --mem-per-cpu=1500MB\n'
    );
    assert.ok(issues.some((i) => i.severity === 'error' && /mutually exclusive/.test(i.message)));
    // each alone is fine, and --mem must not match --mem-per-cpu
    assert.strictEqual(lintSbatch('#SBATCH --time=00:05:00\n#SBATCH --mem=5GB\n').length, 0);
    assert.strictEqual(
        lintSbatch('#SBATCH --time=00:05:00\n#SBATCH --mem-per-cpu=1500MB\n').length,
        0
    );
});

test('isValidJobId accepts SLURM job ids and rejects everything else', () => {
    for (const good of ['12345', '12345_1', '12345.batch', '12345_2.batch']) {
        assert.strictEqual(isValidJobId(good), true, 'should accept ' + good);
    }
    for (const bad of ['', 'abc', '../x', '12;rm -rf /', '12 34', '--help', '12.']) {
        assert.strictEqual(isValidJobId(bad), false, 'should reject ' + JSON.stringify(bad));
    }
    assert.strictEqual(isValidJobId(null), false);
    assert.strictEqual(isValidJobId(12345), false);
});

test('findLogPaths normalizes traversal-style output paths', () => {
    const logs = findLogPaths('#SBATCH --output ../logs/%j.out', '7', '/work/dir');
    assert.strictEqual(logs.output, '/work/logs/7.out');
    // absolute paths are kept as-is (and normalized)
    const abs = findLogPaths('#SBATCH -e /var/tmp//err-%j.txt', '8', '/work/dir');
    assert.strictEqual(abs.error, '/var/tmp/err-8.txt');
});

test('webview scaffold contains controls, single table, and CSP nonce', () => {
    const html = getWebviewContent('x.sbatch', {});
    for (const needle of [
        'id="searchBox"',
        'id="jobsTbody"',
        'id="chips"',
        'data-sort="source"',
        'data-sort="timelimit"',
        'script nonce=',
        "data.type === 'jobs'",
        "type: 'submit'",
        "e.key === 'Enter' && e.shiftKey",
        'setInterval',
        'mini-btn',
        "type: 'openLog'",
        "type: 'openError'",
        '--vscode-editor-background',
        'vscode-light',
        "'R': 'RUNNING'",
        "dir: 'desc'",
        'page-header',
    ]) {
        assert.ok(html.includes(needle), 'missing: ' + needle);
    }
    // one table only (active + history merged)
    assert.strictEqual((html.match(/<tbody/g) || []).length, 1);
});

test('webview inline script parses without syntax errors', () => {
    const html = getWebviewContent('x.sbatch', {});
    const match = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
    assert.ok(match, 'script tag not found');
    assert.doesNotThrow(() => new Function(match[1]));
});

test('PERIOD_LABELS covers all presets', () => {
    for (const k of ['24h', '7d', '30d', 'all', 'custom']) {
        assert.ok(PERIOD_LABELS[k], 'missing label for ' + k);
    }
});

test('escapeHtml escapes text and attribute characters', () => {
    assert.strictEqual(
        escapeHtml('<a href="x">&'),
        '&lt;a href=&quot;x&quot;&gt;&amp;'
    );
    assert.strictEqual(escapeHtml(''), '');
    assert.strictEqual(escapeHtml(null), '');
});
