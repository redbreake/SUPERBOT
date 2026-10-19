'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersistentCommands, postgresPoolConfig } = require('../lib/persistent-commands');
const { Client } = require('pg');

test('TLS verifica certificados y hostname incluso si la URL intenta debilitarlo', () => {
    for (const query of ['', '?sslmode=require', '?sslmode=no-verify', '?sslmode=disable',
        '?sslmode=verify-ca&uselibpqcompat=true', '?ssl=false', '?ssl=0',
        '?sslmode=require&sslmode=no-verify&uselibpqcompat=true']) {
        const config = postgresPoolConfig(`postgresql://user:password@db.example.test/db${query}`);
        const client = new Client(config);
        assert.equal(new URL(config.connectionString).searchParams.get('sslmode'), 'verify-full');
        assert.ok(client.ssl);
        assert.notEqual(client.ssl.rejectUnauthorized, false);
        assert.equal(client.ssl.checkServerIdentity, undefined);
        assert.equal(client.host, 'db.example.test');
        assert.equal(client.password, 'password');
    }
});

test('TLS conserva parámetros ajenos a SSL y credenciales codificadas', () => {
    const config = postgresPoolConfig('postgres://user:p%40ss%3Aword@db.example.test/db?application_name=superbot&channel_binding=require');
    const url = new URL(config.connectionString);
    assert.equal(url.searchParams.get('application_name'), 'superbot');
    assert.equal(url.searchParams.get('channel_binding'), 'require');
    assert.equal(new Client(config).password, 'p@ss:word');
    assert.throws(() => postgresPoolConfig('https://example.test'), /PostgreSQL/);
});

function fakeStore() {
    const saved = new Map();
    return {
        saved,
        async query(sql, args) {
            if (sql.startsWith('INSERT')) saved.set(args[0], args[1]);
            else if (sql.startsWith('DELETE')) saved.delete(args[0]);
            return { rows: [] };
        },
    };
}

test('comandos personalizados se guardan y borran de la base', async () => {
    const commands = new PersistentCommands(['crear', 'borrar'], 'test-db-url');
    commands.pool = fakeStore();
    commands.ready = true;
    assert.equal((await commands.create('!saludo', 'Hola chat')).ok, true);
    assert.equal(commands.pool.saved.get('saludo'), 'Hola chat');
    assert.equal(commands.get('saludo'), 'Hola chat');
    assert.equal((await commands.create('saludo', 'Hola de nuevo')).updated, true);
    assert.equal(commands.pool.saved.get('saludo'), 'Hola de nuevo');
    assert.equal((await commands.remove('!saludo')).ok, true);
    assert.equal(commands.get('saludo'), undefined);
    assert.equal(commands.pool.saved.has('saludo'), false);
});

test('no permite sustituir comandos internos ni respuestas demasiado largas', async () => {
    const commands = new PersistentCommands(['crear', 'borrar'], 'test-db-url');
    commands.pool = fakeStore();
    commands.ready = true;
    assert.equal((await commands.create('!crear', 'robar comando')).error, 'reserved_name');
    assert.equal((await commands.create('bienvenida', 'x'.repeat(451))).error, 'response_too_long');
    assert.equal(commands.pool.saved.size, 0);
});

test('revierte el estado local si falla PostgreSQL', async () => {
    const commands = new PersistentCommands([], 'test-db-url');
    commands.pool = { async query() { throw new Error('Postgres desconectado'); } };
    commands.ready = true;
    const result = await commands.create('hola', 'respuesta');
    assert.equal(result.error, 'database_unavailable');
    assert.equal(commands.get('hola'), undefined);
});

test('sin DATABASE_URL mantiene compatibilidad temporal', async () => {
    const commands = new PersistentCommands([], '');
    assert.equal(await commands.initialize(), false);
    assert.equal((await commands.create('hola', 'respuesta')).ok, true);
    assert.equal((await commands.remove('hola')).ok, true);
});

test('initialize recarga comandos guardados y aplica TLS al pool real', async (t) => {
    const pg = require('pg');
    let poolConfig;
    const OriginalPool = pg.Pool;
    t.after(() => { pg.Pool = OriginalPool; });
    pg.Pool = class {
        constructor(config) { poolConfig = config; }
        on() {}
        async query(sql) {
            return { rows: sql.startsWith('SELECT') ? [{ name: 'saludo', response: 'Persistió' }] : [] };
        }
    };
    const commands = new PersistentCommands([], 'postgresql://user:secret@db.example.test/db?sslmode=no-verify');
    assert.equal(await commands.initialize(), true);
    assert.equal(commands.get('saludo'), 'Persistió');
    assert.equal(commands.ready, true);
    assert.notEqual(new Client(poolConfig).ssl.rejectUnauthorized, false);
});

test('un error de conexión no filtra secretos ni permite guardar temporalmente', async (t) => {
    const pg = require('pg');
    const logged = [];
    let ended = false;
    t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
    const OriginalPool = pg.Pool;
    t.after(() => { pg.Pool = OriginalPool; });
    pg.Pool = class {
        on() {}
        async query() { throw new Error('postgresql://user:secret@db.example.test/db'); }
        async end() { ended = true; }
    };
    const commands = new PersistentCommands([], 'postgresql://user:secret@db.example.test/db');
    assert.equal(await commands.initialize(), false);
    assert.equal(ended, true);
    assert.equal(commands.pool, null);
    assert.equal((await commands.create('saludo', 'No guardar')).error, 'database_unavailable');
    assert.equal(commands.get('saludo'), undefined);
    assert.equal(logged.join(' ').includes('secret'), false);
});
