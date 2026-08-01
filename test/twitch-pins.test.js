'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getPinnedChatMessage,
    sendPinnedChatMessage,
    unpinChatMessage
} = require('../lib/twitch-pins');

const options = {
    broadcasterId: 'canal-123',
    moderatorId: 'bot-456',
    clientId: 'cliente',
    accessToken: 'token'
};

test('envía y fija un mensaje mediante la API de Twitch', async () => {
    const http = {
        async post(url, body, config) {
            assert.equal(url, 'https://api.twitch.tv/helix/chat/messages');
            assert.deepEqual(body, {
                broadcaster_id: 'canal-123',
                sender_id: 'bot-456',
                message: 'Mensaje importante',
                pin: true
            });
            assert.equal(config.headers.Authorization, 'Bearer token');
            return { data: { data: [{ message_id: 'mensaje-789', is_sent: true }] } };
        }
    };

    const result = await sendPinnedChatMessage(http, {
        ...options,
        message: 'Mensaje importante'
    });

    assert.equal(result.message_id, 'mensaje-789');
    assert.equal(result.is_sent, true);
});

test('obtiene el mensaje fijado actual', async () => {
    const http = {
        async get(url, config) {
            assert.equal(url, 'https://api.twitch.tv/helix/chat/pins');
            assert.deepEqual(config.params, {
                broadcaster_id: 'canal-123',
                moderator_id: 'bot-456'
            });
            return { data: { data: [{ message_id: 'mensaje-789' }] } };
        }
    };

    const result = await getPinnedChatMessage(http, options);
    assert.equal(result.message_id, 'mensaje-789');
});

test('devuelve null cuando no hay ningún mensaje fijado', async () => {
    const http = {
        async get() {
            return { data: { data: [] } };
        }
    };

    assert.equal(await getPinnedChatMessage(http, options), null);
});

test('quita el mensaje fijado por su identificador', async () => {
    const http = {
        async delete(url, config) {
            assert.equal(url, 'https://api.twitch.tv/helix/chat/pins');
            assert.deepEqual(config.params, {
                broadcaster_id: 'canal-123',
                moderator_id: 'bot-456',
                message_id: 'mensaje-789'
            });
        }
    };

    await unpinChatMessage(http, {
        ...options,
        messageId: 'mensaje-789'
    });
});
