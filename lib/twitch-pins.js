'use strict';

const PINS_URL = 'https://api.twitch.tv/helix/chat/pins';
const MESSAGES_URL = 'https://api.twitch.tv/helix/chat/messages';

function authHeaders(clientId, accessToken) {
    return {
        'Client-ID': clientId,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    };
}

async function sendPinnedChatMessage(http, options) {
    const response = await http.post(MESSAGES_URL, {
        broadcaster_id: options.broadcasterId,
        sender_id: options.moderatorId,
        message: options.message,
        pin: true
    }, {
        headers: authHeaders(options.clientId, options.accessToken)
    });

    return response.data?.data?.[0] || null;
}

async function getPinnedChatMessage(http, options) {
    const response = await http.get(PINS_URL, {
        headers: authHeaders(options.clientId, options.accessToken),
        params: {
            broadcaster_id: options.broadcasterId,
            moderator_id: options.moderatorId
        }
    });

    return response.data?.data?.[0] || null;
}

async function unpinChatMessage(http, options) {
    await http.delete(PINS_URL, {
        headers: authHeaders(options.clientId, options.accessToken),
        params: {
            broadcaster_id: options.broadcasterId,
            moderator_id: options.moderatorId,
            message_id: options.messageId
        }
    });
}

module.exports = {
    getPinnedChatMessage,
    sendPinnedChatMessage,
    unpinChatMessage
};
