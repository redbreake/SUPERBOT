'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { YouTubeSpamSync, latestVideoFromPage, spamReply } = require('../lib/youtube-spam-sync');

function page(items, tab = '/@Lolweapon/videos') {
    return `<script>var ytInitialData = ${JSON.stringify({ contents: {
        twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: {
            selected: true,
            endpoint: { commandMetadata: { webCommandMetadata: { url: tab } } },
            content: { richGridRenderer: { contents: items.map(content => ({ richItemRenderer: { content } })) } }
        } }] }
    } })};</script>`;
}

function video(id, title) {
    return { videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, lengthText: { simpleText: '25:14' } } };
}

test('omite Shorts y estrenos pendientes y rechaza una pestaña distinta', () => {
    const items = [
        { shortsLockupViewModel: { entityId: 'short' } },
        { videoRenderer: { ...video('premiere123', 'Pronto').videoRenderer, upcomingEventData: {} } },
        video('aV6OW6_Ag_A', 'Título con ñ')
    ];
    assert.deepEqual(latestVideoFromPage(page(items)), { id: 'aV6OW6_Ag_A', title: 'Título con ñ' });
    assert.throws(() => latestVideoFromPage(page(items, '/@Lolweapon/shorts')));
});

test('lee el formato actual de YouTube y crea una respuesta sin variables ejecutables', () => {
    const model = { lockupViewModel: {
        contentId: 'aV6OW6_Ag_A', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        metadata: { lockupMetadataViewModel: { title: { content: 'Nuevo vídeo' } } },
        contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: {
            badges: [{ thumbnailBadgeViewModel: { text: '25:14' } }]
        } }] } }
    } };
    assert.equal(spamReply(latestVideoFromPage(page([model]))), 'Nuevo vídeo https://youtu.be/aV6OW6_Ag_A');
    assert.throws(() => spamReply({ id: 'aV6OW6_Ag_A', title: '${variable}' }));
});

test('recuerda el vídeo existente sin enviar una edición y lo recupera tras reiniciar', async () => {
    let saved;
    let queries = 0;
    const pool = { async query(sql, params) {
        if (sql.startsWith('SELECT')) return { rows: saved ? [{ value: saved }] : [] };
        if (sql.startsWith('INSERT')) saved = JSON.parse(params[1]);
        return { rows: [] };
    } };
    const options = {
        commands: { ready: true, pool }, channel: 'kala',
        client: { readyState: () => 'OPEN', say: () => assert.fail('No debe repetir el comando existente') },
        logger: { log() {}, error() { assert.fail('Error inesperado'); } },
        http: { async get(url, options) {
            if (url.includes('youtube.com')) {
                assert.deepEqual(options.params, { hl: 'es', gl: 'ES' });
                assert.equal(options.headers['Accept-Language'], 'es-ES,es;q=0.9');
                return { data: page([video('aV6OW6_Ag_A', 'Título')]) };
            }
            queries++;
            if (url.includes('/channels/')) return { data: { _id: 'channel' } };
            return { data: [{ command: 'spam', reply: 'Título https://youtu.be/aV6OW6_Ag_A?si=old' }] };
        } }
    };
    await new YouTubeSpamSync(options).tick();
    assert.equal(saved.id, 'aV6OW6_Ag_A');
    const firstQueries = queries;
    await new YouTubeSpamSync(options).tick();
    assert.equal(queries, firstQueries);
});

test('no marca como aplicado un vídeo si StreamElements rechaza la edición', async () => {
    let writes = 0;
    const sync = new YouTubeSpamSync({
        commands: { ready: true, pool: { async query(sql) {
            if (sql.startsWith('INSERT')) writes++;
            return { rows: [] };
        } } },
        channel: 'kala', client: { readyState: () => 'OPEN', async say() {} },
        logger: { error() {}, log() {} },
        http: { async get(url) {
            if (url.includes('youtube.com')) return { data: page([video('aV6OW6_Ag_A', 'Título')]) };
            if (url.includes('/channels/')) return { data: { _id: 'channel' } };
            return { data: [{ command: 'spam', reply: 'Anterior' }] };
        } }
    });
    await sync.tick();
    assert.equal(writes, 0);
    assert.equal(sync.busy, false);
});

test('corrige el título traducido del mismo vídeo y persiste después de verificar la respuesta', async () => {
    let current = 'English title https://youtu.be/aV6OW6_Ag_A';
    let saved = { id: 'aV6OW6_Ag_A', title: 'English title' };
    let sends = 0;
    const sync = new YouTubeSpamSync({
        channel: 'kala',
        commands: { ready: true, pool: { async query(sql, params) {
            if (sql.startsWith('SELECT')) return { rows: saved ? [{ value: saved }] : [] };
            if (sql.startsWith('INSERT')) {
                assert.equal(current, 'Título https://youtu.be/aV6OW6_Ag_A');
                saved = JSON.parse(params[1]);
            }
            return { rows: [] };
        } } },
        client: { readyState: () => 'OPEN', async say(channel, text) {
            assert.equal(channel, 'kala');
            assert.equal(text, '!cmd edit spam Título https://youtu.be/aV6OW6_Ag_A');
            assert.equal(saved.title, 'English title');
            sends++;
            current = text.slice('!cmd edit spam '.length);
        } },
        logger: { error() { assert.fail('Error inesperado'); }, log() {} },
        http: { async get(url) {
            if (url.includes('youtube.com')) return { data: page([video('aV6OW6_Ag_A', 'Título')]) };
            if (url.includes('/channels/')) return { data: { _id: 'channel' } };
            return { data: [{ command: 'spam', reply: current }] };
        } }
    });
    await sync.tick();
    await sync.tick();
    assert.equal(sends, 1);
    assert.equal(saved.id, 'aV6OW6_Ag_A');
});
