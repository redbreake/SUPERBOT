'use strict';

const VIDEOS_URL = 'https://www.youtube.com/@Lolweapon/videos';
const INTERVAL_MS = 10 * 60 * 1000;
const STATE_KEY = 'lolweapon:streamelements:spam';

function latestVideoFromPage(html) {
    const match = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
    if (!match) throw new Error('YouTube no devolvió la lista de vídeos.');
    const data = JSON.parse(match[1]);
    const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const tab = tabs.find(item => item.tabRenderer?.selected)?.tabRenderer;
    const tabUrl = tab?.endpoint?.commandMetadata?.webCommandMetadata?.url;
    if (!tabUrl?.endsWith('/videos')) throw new Error('No se recibió la pestaña Vídeos.');
    const items = tab.content?.richGridRenderer?.contents || [];
    for (const item of items) {
        const content = item.richItemRenderer?.content;
        const legacy = content?.videoRenderer;
        const model = content?.lockupViewModel;
        let id;
        let title;
        if (legacy && legacy.lengthText && !legacy.upcomingEventData) {
            id = legacy.videoId;
            title = legacy.title?.runs?.map(run => run.text).join('');
        } else if (model?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
            // Require a normal duration badge: skip premieres, live videos and Shorts.
            const overlays = model.contentImage?.thumbnailViewModel?.overlays || [];
            const badges = overlays.flatMap(overlay => overlay.thumbnailBottomOverlayViewModel?.badges || []);
            const hasDuration = badges.some(badge => /^\d+(?::\d{2}){1,2}$/.test(badge.thumbnailBadgeViewModel?.text || ''));
            if (!hasDuration) continue;
            id = model.contentId;
            title = model.metadata?.lockupMetadataViewModel?.title?.content;
        }
        if (/^[\w-]{11}$/.test(id || '') && typeof title === 'string' && title.trim()) {
            return { id, title: title.replace(/\s+/g, ' ').trim() };
        }
    }
    throw new Error('No se encontró ningún vídeo publicado en la pestaña Vídeos.');
}

function spamReply(video) {
    // StreamElements expands these expressions. Reject rather than publish a changed title.
    if (/\$[({]/.test(video.title)) throw new Error('Título con variables de StreamElements.');
    const reply = `${video.title} https://youtu.be/${video.id}`;
    if (`!cmd edit spam ${reply}`.length > 500) throw new Error('Título demasiado largo.');
    return reply;
}

class YouTubeSpamSync {
    constructor({ http, client, commands, channel, logger = console }) {
        Object.assign(this, { http, client, commands, channel, logger });
        this.busy = false;
        this.schemaReady = false;
        this.channelId = null;
    }

    async currentCommand() {
        if (!this.channelId) {
            const response = await this.http.get(`https://api.streamelements.com/kappa/v2/channels/${encodeURIComponent(this.channel)}`, { timeout: 15000 });
            this.channelId = response.data._id;
            if (!this.channelId) throw new Error('Canal de StreamElements no encontrado.');
        }
        const response = await this.http.get(`https://api.streamelements.com/kappa/v2/bot/commands/${this.channelId}`, { timeout: 15000 });
        const command = response.data.find(item => item.command === 'spam');
        if (!command) throw new Error('El comando !spam no existe en StreamElements.');
        return command;
    }

    async tick() {
        if (this.busy || !this.client.readyState || !this.commands.ready) return;
        if (this.client.readyState() !== 'OPEN') return;
        this.busy = true;
        try {
            const pool = this.commands.pool;
            if (!this.schemaReady) {
                await pool.query(`CREATE TABLE IF NOT EXISTS public.bot_sync_state (
                    key text PRIMARY KEY,
                    value jsonb NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now()
                )`);
                this.schemaReady = true;
            }
            const page = await this.http.get(VIDEOS_URL, { timeout: 20000 });
            const video = latestVideoFromPage(page.data);
            const reply = spamReply(video);
            const { rows } = await pool.query('SELECT value FROM public.bot_sync_state WHERE key = $1', [STATE_KEY]);
            const previous = rows[0]?.value;
            if (previous?.id === video.id && previous?.title === video.title) return;

            const current = await this.currentCommand();
            // Preserve the existing share URL when it already points to this video.
            const alreadyCurrent = current.reply?.startsWith(`${video.title} `)
                && (current.reply.includes(`youtu.be/${video.id}`) || current.reply.includes(`watch?v=${video.id}`));
            if (!alreadyCurrent) {
                await this.client.say(this.channel, `!cmd edit spam ${reply}`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                const confirmed = await this.currentCommand();
                if (confirmed.reply !== reply) throw new Error('StreamElements no confirmó la actualización de !spam.');
                this.logger.log(`[SPAM] !spam actualizado al vídeo ${video.id}.`);
            }
            await pool.query(`INSERT INTO public.bot_sync_state (key, value) VALUES ($1, $2::jsonb)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
            [STATE_KEY, JSON.stringify(video)]);
        } catch (error) {
            // Do not print HTTP request objects, database URLs or credentials.
            this.logger.error('[SPAM] No se pudo sincronizar !spam; se reintentará en diez minutos.');
        } finally {
            this.busy = false;
        }
    }

    start() {
        if (this.timer) return;
        this.tick();
        this.timer = setInterval(() => this.tick(), INTERVAL_MS);
    }
}

module.exports = { YouTubeSpamSync, latestVideoFromPage, spamReply };
