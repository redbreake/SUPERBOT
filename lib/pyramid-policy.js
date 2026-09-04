'use strict';

const PYRAMID_OWNERS = new Set(['redbreake', 'redbreake1']);
const CLOWN_USER = 'randomonio13';

function getPyramidPolicy(username) {
    const normalizedUsername = String(username || '').toLowerCase();

    if (normalizedUsername === CLOWN_USER) {
        return { response: 'kalatClown', maxSize: null };
    }

    return {
        response: null,
        maxSize: PYRAMID_OWNERS.has(normalizedUsername) ? 10 : 5
    };
}

module.exports = { getPyramidPolicy };
