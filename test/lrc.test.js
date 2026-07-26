'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc } = require('../lib/lrc');

test('convierte marcas LRC a milisegundos y ordena las líneas', () => {
    const lyrics = parseLrc('[00:02.50]Segunda\n[00:01.125]Primera');

    assert.deepEqual(lyrics, [
        { time: 1125, text: 'Primera' },
        { time: 2500, text: 'Segunda' },
    ]);
});

test('ignora archivos sin líneas cantables', () => {
    assert.deepEqual(parseLrc('[ar:Artista]\n[00:01.00]   '), []);
});
