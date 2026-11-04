'use strict';

const STATE_KEY = 'twitch:daily-title';
const POLL_MS = 5 * 60 * 1000;
const QUIET_MS = 12 * 60 * 60 * 1000;
const MAX_GAP_MS = POLL_MS + 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const localFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function dailyClock(now) {
    const parts = Object.fromEntries(localFormat.formatToParts(new Date(now)).map(p => [p.type, p.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const weekday = new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long'
    }).format(new Date(now));
    const midnight = Date.parse(`${date}T00:00:00-03:00`);
    return {
        date,
        title: `Hoy es ${weekday} ok`,
        midnight,
        midnightWindow: parts.hour === '00' && Number(parts.minute) < 5,
        nextMidnight: midnight + DAY_MS
    };
}

function observeTitle(previous, title, now) {
    const continuous = previous && Number.isFinite(previous.lastSeenAt)
        && now >= previous.lastSeenAt && now - previous.lastSeenAt <= MAX_GAP_MS;
    return {
        title,
        lastChangedAt: continuous && previous.title === title && Number.isFinite(previous.lastChangedAt)
            ? previous.lastChangedAt : now,
        lastSeenAt: now,
        processedDate: previous?.processedDate || null
    };
}

class DailyTitle {
    constructor({ commands, client, readTitle, writeTitle, now = Date.now, logger = console }) {
        Object.assign(this, { commands, client, readTitle, writeTitle, now, logger });
        this.busy = false;
        this.schemaReady = false;
    }

    async save(state) {
        await this.commands.pool.query(`INSERT INTO public.bot_sync_state (key, value) VALUES ($1, $2::jsonb)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value || jsonb_build_object(
                'processedDate', GREATEST(public.bot_sync_state.value->>'processedDate', EXCLUDED.value->>'processedDate')
            ), updated_at = now()`,
        [STATE_KEY, JSON.stringify(state)]);
    }

    async tick() {
        if (this.busy || !this.commands.ready || this.client.readyState() !== 'OPEN') return;
        this.busy = true;
        try {
            const pool = this.commands.pool;
            if (!this.schemaReady) {
                await pool.query(`CREATE TABLE IF NOT EXISTS public.bot_sync_state (
                    key text PRIMARY KEY, value jsonb NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now()
                )`);
                this.schemaReady = true;
            }
            const { rows } = await pool.query('SELECT value FROM public.bot_sync_state WHERE key = $1', [STATE_KEY]);
            const current = await this.readTitle();
            const now = this.now();
            const clock = dailyClock(now);
            const state = observeTitle(rows[0]?.value, current, now);
            await this.save(state);
            if (!clock.midnightWindow || state.processedDate === clock.date) return;

            // Claim today's decision before sending to chat: overlapping deploys must not repeat it.
            const claimed = await pool.query(`UPDATE public.bot_sync_state
                SET value = jsonb_set(value, '{processedDate}', to_jsonb($2::text)), updated_at = now()
                WHERE key = $1 AND value->>'processedDate' IS DISTINCT FROM $2
                RETURNING key`, [STATE_KEY, clock.date]);
            if (!claimed.rows.length) return;
            state.processedDate = clock.date;
            if (clock.midnight - state.lastChangedAt < QUIET_MS || current === clock.title) {
                this.logger.log('[TITLE] Título diario omitido: hay un cambio reciente o ya corresponde a hoy.');
                return;
            }

            // Recheck immediately before replacing the entire title.
            const latest = await this.readTitle();
            if (latest !== current) {
                await this.save(observeTitle(state, latest, this.now()));
                return;
            }
            await this.writeTitle(clock.title);
            const confirmed = await this.readTitle();
            const updated = observeTitle(state, confirmed, this.now());
            await this.save(updated);
            if (confirmed !== clock.title) throw new Error('Título diario no confirmado.');
            this.logger.log(`[TITLE] Título diario actualizado: ${clock.title}`);
        } catch {
            this.logger.error('[TITLE] No se pudo completar la revisión del título diario.');
        } finally {
            this.busy = false;
        }
    }

    start() {
        if (this.started) return;
        this.started = true;
        const run = async () => {
            await this.tick();
            const now = this.now();
            this.timer = setTimeout(run, Math.max(1000, Math.min(POLL_MS, dailyClock(now).nextMidnight - now)));
        };
        run();
    }
}

module.exports = { DailyTitle, dailyClock, observeTitle, QUIET_MS };
