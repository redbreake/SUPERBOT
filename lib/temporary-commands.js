'use strict';

const COMMAND_NAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;

function normalizeCommandName(rawName) {
    return String(rawName || '').trim().replace(/^!+/, '').toLowerCase();
}

class TemporaryCommands {
    constructor(reservedNames = []) {
        this.commands = new Map();
        this.reservedNames = new Set(
            [...reservedNames].map(normalizeCommandName).filter(Boolean)
        );
    }

    create(rawName, rawResponse) {
        const name = normalizeCommandName(rawName);
        const response = String(rawResponse || '').trim();

        if (!name || !response) {
            return { ok: false, error: 'missing_fields' };
        }

        if (name.length > 25 || !COMMAND_NAME_PATTERN.test(name)) {
            return { ok: false, error: 'invalid_name' };
        }

        if (response.length > 450) {
            return { ok: false, error: 'response_too_long' };
        }

        if (this.reservedNames.has(name)) {
            return { ok: false, error: 'reserved_name', name };
        }

        const updated = this.commands.has(name);
        this.commands.set(name, response);
        return { ok: true, name, response, updated };
    }

    get(rawName) {
        return this.commands.get(normalizeCommandName(rawName));
    }
}

module.exports = { TemporaryCommands, normalizeCommandName };
