'use strict';

const { TemporaryCommands, normalizeCommandName } = require('./temporary-commands');

class PersistentCommands extends TemporaryCommands {
    constructor(reservedNames = [], databaseUrl = process.env.DATABASE_URL) {
        super(reservedNames);
        this.databaseUrl = databaseUrl;
        this.pool = null;
        this.ready = false;
    }

    async initialize() {
        if (!this.databaseUrl) {
            console.warn('[COMMANDS] DATABASE_URL ausente: los comandos serán temporales.');
            return false;
        }
        const { Pool } = require('pg');
        this.pool = new Pool({
            connectionString: this.databaseUrl,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 8000,
            max: 3,
        });
        try {
            await this.pool.query(`CREATE TABLE IF NOT EXISTS public.custom_commands (
                name varchar(25) PRIMARY KEY,
                response varchar(450) NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now()
            )`);
            const { rows } = await this.pool.query('SELECT name, response FROM public.custom_commands');
            for (const { name, response } of rows) {
                const validated = super.create(name, response);
                if (!validated.ok) console.warn('[COMMANDS] Comando almacenado no válido:', name);
            }
            this.ready = true;
            console.log(`[COMMANDS] ${this.commands.size} comandos permanentes cargados.`);
            return true;
        } catch (error) {
            console.error('[COMMANDS] No se pudo iniciar PostgreSQL:', error.message);
            await this.pool.end().catch(() => {});
            this.pool = null;
            return false;
        }
    }

    async create(rawName, rawResponse) {
        const name = normalizeCommandName(rawName);
        const existed = this.commands.has(name);
        const previous = this.commands.get(name);
        const result = super.create(rawName, rawResponse);
        if (!result.ok) return result;
        if (!this.ready) {
            if (!this.databaseUrl) return result;
            this.restore(name, existed, previous);
            return { ok: false, error: 'database_unavailable' };
        }
        try {
            await this.pool.query(
                `INSERT INTO public.custom_commands (name, response) VALUES ($1, $2)
                ON CONFLICT (name) DO UPDATE SET response = EXCLUDED.response, updated_at = now()`,
                [result.name, result.response]
            );
            return result;
        } catch (error) {
            this.restore(name, existed, previous);
            console.error('[COMMANDS] Error al guardar:', error.message);
            return { ok: false, error: 'database_unavailable' };
        }
    }

    restore(name, existed, previous) {
        if (existed) this.commands.set(name, previous);
        else this.commands.delete(name);
    }

    async remove(rawName) {
        const name = normalizeCommandName(rawName);
        if (!name || !this.commands.has(name)) return { ok: false, error: 'not_found' };
        if (!this.ready) {
            if (!this.databaseUrl) {
                this.commands.delete(name);
                return { ok: true, name };
            }
            return { ok: false, error: 'database_unavailable' };
        }
        try {
            await this.pool.query('DELETE FROM public.custom_commands WHERE name = $1', [name]);
            this.commands.delete(name);
            return { ok: true, name };
        } catch (error) {
            console.error('[COMMANDS] Error al borrar:', error.message);
            return { ok: false, error: 'database_unavailable' };
        }
    }
}

module.exports = { PersistentCommands };
