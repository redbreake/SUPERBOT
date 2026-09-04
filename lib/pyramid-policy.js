'use strict';

const PYRAMID_OWNER = 'redbreake1';
const CLOWN_USER = 'randomonio13';

function getPyramidPolicy(username) {
    const normalizedUsername = String(username || '').toLowerCase();

    if (normalizedUsername === CLOWN_USER) {
        return { response: 'kalatClown', maxSize: null };
    }

    return {
        response: null,
        maxSize: normalizedUsername === PYRAMID_OWNER ? 10 : 5
    };
}

module.exports = { getPyramidPolicy };
