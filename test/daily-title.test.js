'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DailyTitle, dailyClock, observeTitle, QUIET_MS } = require('../lib/daily-title');

test('el día cambia a medianoche argentina, incluidos acentos y cambios de mes', () => {
    assert.equal(dailyClock(Date.parse('2026-11-05T02:59:59Z')).title, 'Hoy es miércoles ok');
    assert.equal(dailyClock(Date.parse('2026-11-05T03:00:00Z')).title, 'Hoy es jueves ok');
    assert.equal(dailyClock(Date.parse('2026-11-05T03:00:00Z')).midnightWindow, true);
    assert.equal(dailyClock(Date.parse('2026-11-05T03:05:00Z')).midnightWindow, false);
    assert.equal(dailyClock(Date.parse('2026-12-31T23:00:00-03:00')).nextMidnight,
        Date.parse('2027-01-01T03:00:00Z'));
});

test('el seguimiento se conserva al reiniciar y se reinicia si hay un cambio o un hueco sin observar', () => {
    const previous = { title: 'Manual', lastChangedAt: 1000, lastSeenAt: 1_000_000, processedDate: '2026-11-04' };
    assert.equal(observeTitle(previous, 'Manual', 1_060_000).lastChangedAt, 1000);
    assert.equal(observeTitle(previous, 'Nuevo', 1_060_000).lastChangedAt, 1_060_000);
    assert.equal(observeTitle(previous, 'Manual', 2_000_000).lastChangedAt, 2_000_000);
    assert.equal(observeTitle(null, 'Manual', 1_060_000).lastChangedAt, 1_060_000);
});

function setup({ now = Date.parse('2026-11-05T03:00:00Z'), age = QUIET_MS,
    previousTitle = 'Título manual', currentTitle = previousTitle, empty = false,
    processedDate = '2026-11-04', racingTitle = null, confirm = true } = {}) {
    let current = currentTitle;
    let state = empty ? undefined : {
        title: previousTitle, lastChangedAt: now - age, lastSeenAt: now - 60_000, processedDate
    };
    const sent = [];
    let reads = 0;
    const pool = { async query(sql, params) {
        if (sql.startsWith('SELECT')) return { rows: state ? [{ value: structuredClone(state) }] : [] };
        if (sql.startsWith('INSERT')) {
            const next = JSON.parse(params[1]);
            next.processedDate = [next.processedDate, state?.processedDate].filter(Boolean).sort().at(-1) || null;
            state = next;
        }
        if (sql.startsWith('UPDATE')) {
            if (state.processedDate === params[1]) return { rows: [] };
            state.processedDate = params[1];
            return { rows: [{ key: params[0] }] };
        }
        return { rows: [] };
    } };
    const options = {
        commands: { ready: true, pool }, client: { readyState: () => 'OPEN' },
        now: () => now, logger: { log() {}, error() {} },
        async readTitle() {
            reads++;
            if (racingTitle && reads === 2) current = racingTitle;
            return current;
        },
        async writeTitle(title) { sent.push(title); if (confirm) current = title; }
    };
    return { options, sent, state: () => state };
}

test('a medianoche reemplaza el título completo con 12 horas cumplidas y no repite tras reiniciar', async () => {
    const env = setup();
    await new DailyTitle(env.options).tick();
    await new DailyTitle(env.options).tick();
    assert.deepEqual(env.sent, ['Hoy es jueves ok']);
    assert.equal(env.state().title, 'Hoy es jueves ok');
});

test('respeta cambios recientes, incluido un cambio detectado justo a medianoche', async () => {
    for (const config of [{ age: QUIET_MS - 1 }, { currentTitle: 'Cambio manual reciente' }]) {
        const env = setup(config);
        await new DailyTitle(env.options).tick();
        assert.deepEqual(env.sent, []);
        assert.equal(env.state().processedDate, '2026-11-05');
    }
});

test('evalúa las 12 horas respecto de medianoche, aunque el timer se retrase', async () => {
    const env = setup({ now: Date.parse('2026-11-05T03:02:00Z'), age: QUIET_MS });
    await new DailyTitle(env.options).tick();
    assert.deepEqual(env.sent, []);
});

test('primera ejecución aprende el título sin suponer la fecha del último cambio', async () => {
    const env = setup({ empty: true });
    await new DailyTitle(env.options).tick();
    assert.deepEqual(env.sent, []);
});

test('fuera de medianoche solo registra el seguimiento', async () => {
    const env = setup({ now: Date.parse('2026-11-05T17:00:00Z') });
    await new DailyTitle(env.options).tick();
    assert.deepEqual(env.sent, []);
    assert.equal(env.state().processedDate, '2026-11-04');
});

test('respeta un cambio manual que llega entre la revisión y el envío', async () => {
    const env = setup({ racingTitle: 'Manual justo ahora' });
    await new DailyTitle(env.options).tick();
    assert.deepEqual(env.sent, []);
    assert.equal(env.state().title, 'Manual justo ahora');
});

test('una edición sin confirmar no se repite por reiniciar el bot', async () => {
    const env = setup({ confirm: false });
    await new DailyTitle(env.options).tick();
    await new DailyTitle(env.options).tick();
    assert.equal(env.sent.length, 1);
    assert.equal(env.state().title, 'Título manual');
});
