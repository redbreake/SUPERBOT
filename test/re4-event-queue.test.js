'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Re4EventQueue } = require('../lib/re4-event-queue');

test('publica y confirma un evento de Bits', () => {
    const queue = new Re4EventQueue();
    const event = queue.publish({ bits: 500, username: 'chat_prueba' });

    assert.equal(event.bits, 500);
    assert.equal(event.source, 'twitch');
    assert.deepEqual(queue.list(), [event]);
    assert.equal(queue.acknowledge(event.id), true);
    assert.deepEqual(queue.list(), []);
});

test('limita la cola y limpia nombres no seguros', () => {
    const queue = new Re4EventQueue({ maxEvents: 2 });
    queue.publish({ bits: 100, username: 'uno' });
    queue.publish({ bits: 200, username: 'dos|\ntres' });
    queue.publish({ bits: 300, username: 'cuatro' });

    const events = queue.list();
    assert.equal(events.length, 2);
    assert.equal(events[0].username, 'dos  tres');
    assert.equal(events[1].bits, 300);
});

test('rechaza cantidades de Bits inválidas', () => {
    const queue = new Re4EventQueue();
    assert.throws(() => queue.publish({ bits: 0, username: 'x' }));
    assert.throws(() => queue.publish({ bits: 1.5, username: 'x' }));
});
