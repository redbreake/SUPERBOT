'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getPyramidPolicy } = require('../lib/pyramid-policy');

test('responde con kalatClown a randomonio13', () => {
    assert.deepEqual(getPyramidPolicy('Randomonio13'), {
        response: 'kalatClown',
        maxSize: null
    });
});

test('permite pirámides de hasta 10 a redbreake y redbreake1', () => {
    assert.deepEqual(getPyramidPolicy('redbreake'), {
        response: null,
        maxSize: 10
    });
    assert.deepEqual(getPyramidPolicy('redbreake1'), {
        response: null,
        maxSize: 10
    });
});

test('limita al resto de usuarios habilitados a un tamaño de 5', () => {
    assert.deepEqual(getPyramidPolicy('otro_mod'), {
        response: null,
        maxSize: 5
    });
});
