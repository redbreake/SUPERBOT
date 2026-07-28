'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TemporaryCommands, normalizeCommandName } = require('../lib/temporary-commands');

test('normaliza nombres con o sin signo de exclamación', () => {
    assert.equal(normalizeCommandName('!Web'), 'web');
    assert.equal(normalizeCommandName('RESUBIDOS'), 'resubidos');
});

test('crea y ejecuta un comando temporal', () => {
    const commands = new TemporaryCommands();
    const result = commands.create('!web', 'Nuestra web es https://example.com/');

    assert.equal(result.ok, true);
    assert.equal(result.updated, false);
    assert.equal(commands.get('WEB'), 'Nuestra web es https://example.com/');
});

test('actualiza un comando temporal existente', () => {
    const commands = new TemporaryCommands();
    commands.create('saludo', 'Hola');
    const result = commands.create('!saludo', 'Buenas');

    assert.equal(result.ok, true);
    assert.equal(result.updated, true);
    assert.equal(commands.get('saludo'), 'Buenas');
});

test('rechaza comandos internos, nombres inválidos y respuestas demasiado largas', () => {
    const commands = new TemporaryCommands(['crear', 'resubidos']);

    assert.equal(commands.create('!crear', 'texto').error, 'reserved_name');
    assert.equal(commands.create('nombre con espacios', 'texto').error, 'invalid_name');
    assert.equal(commands.create('válido', 'x'.repeat(451)).error, 'response_too_long');
});
