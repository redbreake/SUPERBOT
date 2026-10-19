'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersistentCommands } = require('../lib/persistent-commands');

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
