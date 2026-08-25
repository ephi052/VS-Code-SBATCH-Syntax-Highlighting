'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const grammar = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, '..', 'syntaxes', 'sbatch.tmLanguage.json'),
        'utf8'
    )
);

const directive = grammar.patterns.find(
    (p) => p.begin && p.begin.includes('#SBATCH')
);
assert.ok(directive, 'grammar must contain the #SBATCH begin rule');
const inner = directive.patterns;

function findByName(name) {
    return inner.find((p) => p.name === name);
}
function blockByBegin(marker) {
    return inner.find((p) => p.begin && p.begin.includes(marker));
}

const memBlock = blockByBegin('--mem-per-gpu');
const timeBlock = blockByBegin('--time');
const outputBlock = blockByBegin('--output');
const mailType = blockByBegin('--mail-on-event');
const numericBlock = blockByBegin('--ntasks-per-node');
const gres = blockByBegin('--gres');
const invalid = inner.filter((p) => p.name === 'invalid.illegal.sbatch');

const memory = memBlock.patterns.find(
    (p) => p.captures && p.captures['2'] && p.captures['2'].name === 'constant.other.unit.sbatch'
);
const time = timeBlock.patterns.find((p) => p.name === 'constant.numeric.time.sbatch');
const placeholderSplit = outputBlock.patterns.find(
    (p) => p.captures && p.captures['2'] && p.captures['2'].name === 'constant.character.format.placeholder.sbatch'
);
const pathToken = outputBlock.patterns.find(
    (p) => p.name === 'string.other.path.sbatch' && !p.match.includes('\\S')
);
const enumRule = mailType.patterns.find((p) => p.name === 'constant.language.sbatch');
const param = findByName('variable.parameter.sbatch');
const numeric = findByName('constant.numeric.sbatch');
const slurmVar = findByName('variable.language.slurm.sbatch');
const disabled = grammar.patterns.find((p) => p.name === 'comment.line.disabled.sbatch');
const gresFull = gres.patterns.find((p) => p.captures && p.captures['5']);
const gresTypeCount = gres.patterns.find((p) => p.captures && p.captures['3'] && !p.captures['4']);
const gresTypeModel = gres.patterns.find(
    (p) => p.captures && p.captures['3'] && p.captures['3'].name === 'entity.name.resource.sbatch' && p.captures['2'] && !p.captures['4']
);

function re(patternSource) {
    return new RegExp(patternSource);
}

/**
 * Minimal TextMate-style tokenizer: tries patterns in order at each position,
 * supports begin/end blocks (one level of nesting, quoted strings handled as
 * atomic tokens) and capture-based matches. Used to verify option-awareness.
 */
function tokenizeDirective(line) {
    const text = line.replace(/^#SBATCH\s*/, '');
    const tokens = [];
    scan(text, inner, tokens, 0);
    return tokens;
}

function scan(text, patterns, tokens, pos) {
    while (pos < text.length) {
        let matched = false;
        for (const p of patterns) {
            const src = p.match || (p.begin || null);
            if (!src) continue;
            const m = new RegExp('^(?:' + src + ')').exec(text.slice(pos));
            if (!m) continue;

            if (p.begin && p.beginCaptures && p.beginCaptures['0']) {
                // quoted string: consume through the closing quote as one token
                const close = text.indexOf(p.end, pos + 1);
                const end = close === -1 ? text.length : close + 1;
                tokens.push({ text: text.slice(pos, end), scope: p.name });
                pos = end;
                matched = true;
                break;
            }

            if (p.begin) {
                if (p.beginCaptures && p.beginCaptures['1'] && m[1]) {
                    const off = m[0].indexOf(m[1]);
                    tokens.push({
                        text: text.slice(pos + off, pos + off + m[1].length),
                        scope: p.beginCaptures['1'].name,
                    });
                }
                if (p.beginCaptures && p.beginCaptures['2'] && m[2]) {
                    const off = m[0].indexOf(m[2]);
                    tokens.push({
                        text: text.slice(pos + off, pos + off + m[2].length),
                        scope: p.beginCaptures['2'].name,
                    });
                }
                pos += m[0].length;
                const endRe = new RegExp('^(?:' + p.end + ')');
                while (pos < text.length && !endRe.test(text.slice(pos))) {
                    const before = pos;
                    pos = scan(text, p.patterns || [], tokens, pos);
                    if (pos === before) {
                        pos++;
                        break;
                    }
                }
                matched = true;
                break;
            }

            if (p.captures) {
                for (let g = 1; g <= 5; g++) {
                    const cn = p.captures[String(g)] ? p.captures[String(g)].name : null;
                    if (cn && m[g] !== undefined) {
                        const off = m[0].indexOf(m[g]);
                        tokens.push({
                            text: text.slice(pos + off, pos + off + m[g].length),
                            scope: cn,
                        });
                    }
                }
                pos += m[0].length;
                matched = true;
                break;
            }

            tokens.push({ text: text.slice(pos, pos + m[0].length), scope: p.name });
            pos += m[0].length;
            matched = true;
            break;
        }
        if (!matched) pos++;
    }
    return pos;
}

test('grammar contains all semantic categories', () => {
    assert.ok(directive.beginCaptures['1'].name === 'keyword.control.sbatch');
    assert.ok(memBlock && memory, 'mem block with quantity pattern');
    assert.ok(timeBlock && time, 'time block with time literal');
    assert.ok(outputBlock && placeholderSplit && pathToken, 'output block with filename grammar');
    assert.ok(numericBlock, 'numeric options block');
    assert.ok(mailType && enumRule, 'mail-type block with enums');
    assert.strictEqual(invalid.length, 2, 'two invalid-scope rules');
    assert.ok(param, 'generic option pattern');
    assert.ok(numeric, 'generic numeric pattern');
    assert.ok(slurmVar, 'slurm variable pattern');
    assert.ok(disabled, 'disabled directive pattern');

    // structured-value rules must NOT be global anymore
    assert.ok(!inner.some((p) => p.name === 'constant.numeric.time.sbatch'), 'time scope is option-aware');
    assert.ok(!inner.some((p) => p.name === 'constant.other.unit.sbatch'), 'memory scope is option-aware');
    assert.ok(!inner.some((p) => p.name === 'constant.language.sbatch'), 'enums are option-aware');
});

test('memory quantities split number and unit (inside --mem)', () => {
    const r = re(memory.match);
    let m = r.exec('32G');
    assert.deepStrictEqual([m[1], m[2]], ['32', 'G']);
    m = r.exec('5GB');
    assert.deepStrictEqual([m[1], m[2]], ['5', 'GB']);
    m = r.exec('1500MB');
    assert.deepStrictEqual([m[1], m[2]], ['1500', 'MB']);
    m = r.exec('4.5GiB');
    assert.deepStrictEqual([m[1], m[2]], ['4.5', 'GiB']);
    assert.strictEqual(r.exec('4'), null);
    assert.strictEqual(r.exec('0-00:02:00'), null);
});

test('time literals get their own scope (inside --time)', () => {
    const r = re(time.match);
    for (const good of ['0-00:02:00', '01:00:00', '00:05', '1-00:00']) {
        assert.strictEqual(r.test(good), true, 'should match ' + good);
    }
    assert.strictEqual(r.test('5'), false);
    assert.strictEqual(r.test('abc'), false);
});

test('paths with placeholders split into string + placeholder + string (inside --output)', () => {
    const r = re(placeholderSplit.match);
    let m = r.exec('job-%J.out');
    assert.deepStrictEqual([m[1], m[2], m[3]], ['job-', '%J', '.out']);
    m = r.exec('logs/job-%j.out');
    assert.deepStrictEqual([m[1], m[2], m[3]], ['logs/job-', '%j', '.out']);
    m = r.exec('%j.out');
    assert.deepStrictEqual([m[1], m[2], m[3]], ['', '%j', '.out']);
});

test('path tokens match paths and emails but not identifiers', () => {
    const r = re(pathToken.match);
    for (const good of ['/Filepath', 'filepath.err', 'user@post.jce.ac.il']) {
        assert.strictEqual(r.test(good), true, 'should match ' + good);
    }
    assert.strictEqual(r.test('main'), false);
    assert.strictEqual(r.test('ALL'), false);
});

test('options match long and short forms only', () => {
    const r = re(param.match);
    for (const good of ['--job-name', '--mem-per-cpu', '-N', '-t']) {
        assert.strictEqual(r.test(good), true, 'should match ' + good);
    }
    assert.strictEqual(r.test('my_job'), false);
    assert.strictEqual(r.test('main'), false);
});

test('disabled directives match any extra # prefix', () => {
    const r = re(disabled.match);
    for (const good of ['##SBATCH --mem=32G', '###SBATCH --time=1', '####SBATCH --x']) {
        assert.strictEqual(r.test(good), true, 'should match ' + good);
    }
    assert.strictEqual(r.test('#SBATCH --time=1'), false);
    assert.strictEqual(r.test('##SBATCHx'), false);
});

test('known enum values are option-aware (mail-type only)', () => {
    const r = re(enumRule.match);
    for (const good of ['ALL', 'BEGIN', 'END', 'FAIL', 'NONE', 'REQUEUE', 'TIME_LIMIT']) {
        assert.strictEqual(r.test(good), true, 'should match ' + good);
    }
    assert.strictEqual(r.test('main'), false);
    assert.strictEqual(r.test('ALLEN'), false);
    assert.strictEqual(r.test('job_name'), false);

    const begin = re(mailType.begin).exec('--mail-type=END,FAIL');
    assert.strictEqual(begin[1], '--mail-type');
    assert.strictEqual(begin[2], '=');
});

test('invalid scope flags dangling -- and whitespace around =', () => {
    const dangling = re(invalid[0].match);
    assert.strictEqual(dangling.test('--'), true);
    assert.strictEqual(dangling.test('-- '), true);
    assert.strictEqual(dangling.test('--job-name'), false);

    const spacedEq = re(invalid[1].match);
    assert.strictEqual(spacedEq.test('--job-name = my_job'), true);
    assert.strictEqual(spacedEq.test('--job-name= my_job'), true);
    assert.strictEqual(spacedEq.test('--mem =5GB'), true);
    assert.strictEqual(spacedEq.test('--mem=5GB'), false);
    assert.strictEqual(spacedEq.test('--mail-type=END,FAIL'), false);
});

test('SLURM variables are distinct from shell variables', () => {
    const r = re(slurmVar.match);
    for (const good of ['$SLURM_JOBID', '${SLURM_JOB_NODELIST}', '$SLURM_ARRAY_TASK_ID']) {
        assert.strictEqual(r.test(good), true, 'should match ' + good);
    }
    assert.strictEqual(r.test('$HOME'), false);
    assert.strictEqual(r.test('$MY_VARIABLE'), false);
});

test('gres splits type/model/count semantically', () => {
    let m = re(gresFull.match).exec('gpu:a100:2');
    assert.deepStrictEqual([m[1], m[3], m[5]], ['gpu', 'a100', '2']);
    m = re(gresTypeCount.match).exec('gpu:2');
    assert.deepStrictEqual([m[1], m[3]], ['gpu', '2']);
    m = re(gresTypeModel.match).exec('gpu:a100');
    assert.deepStrictEqual([m[1], m[3]], ['gpu', 'a100']);

    const begin = re(gres.begin).exec('--gres=gpu:a100:2');
    assert.strictEqual(begin[1], '--gres');
    assert.strictEqual(begin[2], '=');
});

// ---------- option-aware end-to-end tests (mini tokenizer) ----------

test('option-aware values tokenize with the right scopes', () => {
    const cases = [
        [
            '#SBATCH --time=0-00:05:00',
            [['--time', 'variable.parameter.sbatch'], ['=', 'keyword.operator.assignment.sbatch'], ['0-00:05:00', 'constant.numeric.time.sbatch']],
        ],
        [
            '#SBATCH --mem=32G',
            [['--mem', 'variable.parameter.sbatch'], ['=', 'keyword.operator.assignment.sbatch'], ['32', 'constant.numeric.sbatch'], ['G', 'constant.other.unit.sbatch']],
        ],
        [
            '#SBATCH --output=logs/job-%j.out',
            [['--output', 'variable.parameter.sbatch'], ['=', 'keyword.operator.assignment.sbatch'], ['logs/job-', 'string.other.path.sbatch'], ['%j', 'constant.character.format.placeholder.sbatch'], ['.out', 'string.other.path.sbatch']],
        ],
        [
            '#SBATCH --nodes=4',
            [['--nodes', 'variable.parameter.sbatch'], ['=', 'keyword.operator.assignment.sbatch'], ['4', 'constant.numeric.sbatch']],
        ],
        [
            '#SBATCH --mail-type=END,FAIL',
            [['--mail-type', 'variable.parameter.sbatch'], ['=', 'keyword.operator.assignment.sbatch'], ['END', 'constant.language.sbatch'], ['FAIL', 'constant.language.sbatch']],
        ],
    ];
    for (const [line, expected] of cases) {
        const got = tokenizeDirective(line).map((t) => [t.text, t.scope]);
        assert.deepStrictEqual(got, expected, line);
    }
});

test('no structured-value leakage into plain options', () => {
    const got = (line) => tokenizeDirective(line).map((t) => [t.text, t.scope]);

    // 32G in --job-name must NOT produce a unit token
    const jn = got('#SBATCH --job-name=32G');
    assert.ok(
        !jn.some((t) => t[1] === 'constant.other.unit'),
        'unit scope leaked into --job-name: ' + JSON.stringify(jn)
    );

    // a time literal in --job-name must NOT get the time scope
    const jn2 = got('#SBATCH --job-name 0-00:05:00');
    assert.ok(
        !jn2.some((t) => t[1] === 'constant.numeric.time'),
        'time scope leaked into --job-name: ' + JSON.stringify(jn2)
    );

    // enums must not leak into --partition
    const part = got('#SBATCH --partition END');
    assert.ok(
        !part.some((t) => t[1] === 'constant.language'),
        'enum scope leaked into --partition: ' + JSON.stringify(part)
    );

    // a % placeholder must not be interpreted outside --output/--error
    const comment = got('#SBATCH --comment=100% done');
    assert.ok(
        !comment.some((t) => t[1] === 'constant.character.format.placeholder'),
        'placeholder scope leaked into --comment: ' + JSON.stringify(comment)
    );
});
