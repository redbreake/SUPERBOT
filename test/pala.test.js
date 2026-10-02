'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseTwitchDuration,
    getCalendarDaysDiff,
    formatPalaMessage,
    getPalaStatus
} = require('../lib/pala-utils');

test('parseTwitchDuration convierte duraciones de Twitch a milisegundos', () => {
    assert.equal(parseTwitchDuration('3h25m12s'), (3 * 3600 + 25 * 60 + 12) * 1000);
    assert.equal(parseTwitchDuration('45m10s'), (45 * 60 + 10) * 1000);
    assert.equal(parseTwitchDuration('2h'), 2 * 3600 * 1000);
    assert.equal(parseTwitchDuration('50s'), 50 * 1000);
    assert.equal(parseTwitchDuration('1h30s'), (3600 + 30) * 1000);
    assert.equal(parseTwitchDuration(''), 0);
    assert.equal(parseTwitchDuration(null), 0);
    assert.equal(parseTwitchDuration(undefined), 0);
});

test('getCalendarDaysDiff calcula correctamente días calendario', () => {
    const d1 = new Date('2026-09-24T21:33:13Z');
    const d2 = new Date('2026-10-02T18:00:00Z');
    assert.equal(getCalendarDaysDiff(d1, d2, 'Europe/Madrid'), 8);
    assert.equal(getCalendarDaysDiff(d1, d2, 'UTC'), 8);
    assert.equal(getCalendarDaysDiff(d1, d2, 'America/Argentina/Buenos_Aires'), 8);

    // Mismo día
    const todayMorning = new Date('2026-10-02T02:00:00Z');
    const todayEvening = new Date('2026-10-02T20:00:00Z');
    assert.equal(getCalendarDaysDiff(todayMorning, todayEvening, 'UTC'), 0);

    // Ayer
    const yesterday = new Date('2026-10-01T20:00:00Z');
    assert.equal(getCalendarDaysDiff(yesterday, todayEvening, 'UTC'), 1);
});

test('formatPalaMessage responde adecuadamente cuando está en directo', () => {
    const msg = formatPalaMessage({ isLive: true, streamerName: 'Kala' });
    assert.equal(msg, '¡Pero si Kala está en directo ahora mismo agarrando la pala! ⛏️');
});

test('formatPalaMessage responde con error cuando no hay fecha válida', () => {
    assert.equal(
        formatPalaMessage({ isLive: false, endedAt: null }),
        'No encuentro ningún VOD reciente de Kala para calcular los días sin pala.'
    );
    assert.equal(
        formatPalaMessage({ isLive: false, endedAt: NaN }),
        'No encuentro ningún VOD reciente de Kala para calcular los días sin pala.'
    );
    assert.equal(
        formatPalaMessage({ isLive: false, endedAt: Date.now() + 100000 }),
        'No encuentro ningún VOD reciente de Kala para calcular los días sin pala.'
    );
});

test('formatPalaMessage formatea correctamente cuando terminó hoy', () => {
    // 2 de Octubre a las 15:00 UTC
    const now = Date.parse('2026-10-02T15:00:00Z');

    // Mismo día a las 14:30 (hace 30 min)
    const ended30mAgo = Date.parse('2026-10-02T14:30:00Z');
    assert.equal(
        formatPalaMessage({ isLive: false, endedAt: ended30mAgo, now, timeZone: 'UTC' }),
        '¡Kala terminó stream hace menos de una hora, así que hoy sí agarró la pala! ⛏️'
    );

    // Mismo día a las 10:00 (hace 5 horas)
    const ended5hAgo = Date.parse('2026-10-02T10:00:00Z');
    assert.equal(
        formatPalaMessage({ isLive: false, endedAt: ended5hAgo, now, timeZone: 'UTC' }),
        '¡Kala agarró la pala hoy mismo! (hace 5 horas) ⛏️'
    );
});

test('formatPalaMessage formatea correctamente ayer (1 día) y varios días', () => {
    const now = Date.parse('2026-10-02T18:00:00Z');

    // 1 de Octubre a las 20:00 UTC (ayer)
    const endedYesterday = Date.parse('2026-10-01T20:00:00Z');
    assert.equal(
        formatPalaMessage({ isLive: false, endedAt: endedYesterday, now, timeZone: 'UTC' }),
        'Kala lleva 1 día sin agarrar la pala (último stream: ayer).'
    );

    // Jueves 24 de Septiembre a las 21:33 UTC (hace 8 días de calendario)
    const endedThursdayLastWeek = Date.parse('2026-09-24T21:33:13Z');
    assert.equal(
        formatPalaMessage({ isLive: false, endedAt: endedThursdayLastWeek, now, timeZone: 'Europe/Madrid' }),
        'Kala lleva 8 días sin agarrar la pala.'
    );
});

test('getPalaStatus usa la caché si aún está vigente', async () => {
    let llamadasApi = 0;
    const axiosMock = {
        async get() {
            llamadasApi++;
            return { data: { data: [] } };
        }
    };

    const cache = { text: 'Respuesta en caché', timestamp: 10000 };
    const res = await getPalaStatus({
        axios: axiosMock,
        broadcasterId: '123',
        clientId: 'cid',
        accessToken: 'token',
        cache,
        now: 20000,
        ttlMs: 60000
    });

    assert.equal(res, 'Respuesta en caché');
    assert.equal(llamadasApi, 0);
});

test('getPalaStatus detecta cuando el stream está en directo', async () => {
    const axiosMock = {
        async get(url, opts) {
            if (url.includes('/helix/streams')) {
                assert.equal(opts.params.user_id, 'canal-123');
                return {
                    data: {
                        data: [{ type: 'live', id: 'stream-1' }]
                    }
                };
            }
            throw new Error('No debería llamar a videos si está live');
        }
    };

    const cache = { text: null, timestamp: 0 };
    const res = await getPalaStatus({
        axios: axiosMock,
        broadcasterId: 'canal-123',
        clientId: 'cid',
        accessToken: 'token',
        cache,
        now: 100000
    });

    assert.equal(res, '¡Pero si Kala está en directo ahora mismo agarrando la pala! ⛏️');
    assert.equal(cache.text, res);
    assert.equal(cache.timestamp, 100000);
});

test('getPalaStatus calcula días calendario con el último VOD si no está en directo', async () => {
    const now = Date.parse('2026-10-02T18:00:00Z');
    const vodStarted = '2026-09-24T19:20:28Z'; // Jueves 24
    const duration = '2h13m13s'; // Terminó 21:33 UTC (Jueves 24)

    const axiosMock = {
        async get(url) {
            if (url.includes('/helix/streams')) {
                return { data: { data: [] } };
            }
            if (url.includes('/helix/videos')) {
                return {
                    data: {
                        data: [{
                            created_at: vodStarted,
                            duration
                        }]
                    }
                };
            }
            throw new Error(`URL inesperada: ${url}`);
        }
    };

    const res = await getPalaStatus({
        axios: axiosMock,
        broadcasterId: 'canal-123',
        clientId: 'cid',
        accessToken: 'token',
        now,
        timeZone: 'Europe/Madrid'
    });

    assert.equal(res, 'Kala lleva 8 días sin agarrar la pala.');
});
