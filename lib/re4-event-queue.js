'use strict';

const { randomUUID } = require('node:crypto');

class Re4EventQueue {
    constructor({ maxEvents = 100, ttlMs = 15 * 60 * 1000 } = {}) {
        if (!Number.isInteger(maxEvents) || maxEvents < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
            throw new Error('Límites de cola inválidos.');
        }
        this.maxEvents = maxEvents;
        this.ttlMs = ttlMs;
        this.events = new Map();
    }

    publish({ bits, username }) {
        const amount = Number(bits);
        if (!Number.isInteger(amount) || amount < 1 || amount > 100_000) {
            throw new Error('La cantidad de Bits debe ser un entero entre 1 y 100000.');
        }

        this.prune();
        while (this.events.size >= this.maxEvents) {
            this.events.delete(this.events.keys().next().value);
        }

        const event = {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            source: 'twitch',
            username: String(username || 'anonimo').trim().replace(/[|\r\n]/g, ' ').slice(0, 80) || 'anonimo',
            bits: amount,
        };
        this.events.set(event.id, event);
        return event;
    }

    list() {
        this.prune();
        return [...this.events.values()];
    }

    acknowledge(id) {
        return this.events.delete(id);
    }

    prune(now = Date.now()) {
        for (const [id, event] of this.events) {
            if (now - Date.parse(event.createdAt) > this.ttlMs) this.events.delete(id);
        }
    }
}

module.exports = { Re4EventQueue };
