'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoId, findYouTubeUrls } = require('../lib/youtube-utils');

test('extrae IDs de enlaces comunes de YouTube', () => {
    const id = 'dQw4w9WgXcQ';

    assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}`), id);
    assert.equal(extractVideoId(`https://youtu.be/${id}`), id);
    assert.equal(extractVideoId(`https://www.youtube.com/shorts/${id}`), id);
});

test('rechaza enlaces sin un ID válido', () => {
    assert.equal(extractVideoId('https://youtube.com/watch?v=corto'), null);
});

test('encuentra enlaces dentro de un mensaje', () => {
    const message = 'Tema: https://youtu.be/dQw4w9WgXcQ?si=abc';
    assert.deepEqual(findYouTubeUrls(message), ['https://youtu.be/dQw4w9WgXcQ?si=abc']);
});
