'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    containsModeratedLink,
    findLinks,
    isOfficialTwitchClipUrl
} = require('../lib/link-utils');

test('detecta enlaces HTTP y HTTPS dentro de un mensaje', () => {
    assert.deepEqual(
        findLinks('Mira https://example.com y http://example.org/video'),
        ['https://example.com', 'http://example.org/video']
    );
});

test('reconoce los dos formatos oficiales de clips de Twitch', () => {
    assert.equal(isOfficialTwitchClipUrl('https://clips.twitch.tv/ClipDeEjemplo'), true);
    assert.equal(isOfficialTwitchClipUrl('https://www.twitch.tv/kala/clip/ClipDeEjemplo'), true);
    assert.equal(isOfficialTwitchClipUrl('https://twitch.tv/kala/clip/ClipDeEjemplo?filter=clips'), true);
});

test('rechaza dominios engañosos y otros enlaces de Twitch', () => {
    assert.equal(isOfficialTwitchClipUrl('https://clips.twitch.tv.sitio-raro.com/Clip'), false);
    assert.equal(isOfficialTwitchClipUrl('https://www.twitch.tv/videos/123456'), false);
    assert.equal(isOfficialTwitchClipUrl('https://www.twitch.tv/kala'), false);
    assert.equal(isOfficialTwitchClipUrl('https://clips.twitch.tv/'), false);
});

test('no modera un mensaje que contiene únicamente clips oficiales', () => {
    assert.equal(
        containsModeratedLink('Mira https://clips.twitch.tv/Uno y https://www.twitch.tv/kala/clip/Dos'),
        false
    );
});

test('modera si un clip oficial está acompañado por otro enlace', () => {
    assert.equal(
        containsModeratedLink('Clip https://clips.twitch.tv/Uno y web https://example.com'),
        true
    );
});
