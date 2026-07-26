'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../lib/config');

function validConfig() {
    return {
        TWITCH_ACCESS_TOKEN: 'token',
        TWITCH_CLIENT_ID: 'client',
        BOT_USERNAME: 'bot',
        CHANNEL_NAME: 'canal',
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: undefined,
        GOOGLE_REDIRECT_URI: undefined,
        PLAYLIST_ID: undefined,
        MIN_BITS_SONG: 200,
    };
}

test('acepta una configuración mínima de Twitch', () => {
    assert.deepEqual(validateConfig(validConfig()), []);
});

test('informa variables obligatorias ausentes', () => {
    const config = validConfig();
    config.TWITCH_ACCESS_TOKEN = undefined;

    assert.match(validateConfig(config)[0], /TWITCH_ACCESS_TOKEN/);
});

test('rechaza una configuración parcial de YouTube', () => {
    const config = validConfig();
    config.GOOGLE_CLIENT_ID = 'client';

    assert.match(validateConfig(config)[0], /YouTube está incompleta/);
});
