'use strict';

function findLinks(message) {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return message.match(urlPattern) || [];
}

function isOfficialTwitchClipUrl(value) {
    try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase();
        const pathParts = url.pathname.split('/').filter(Boolean);

        if (hostname === 'clips.twitch.tv') {
            return pathParts.length >= 1;
        }

        if (hostname === 'twitch.tv' || hostname === 'www.twitch.tv') {
            return pathParts.length === 3
                && pathParts[1].toLowerCase() === 'clip';
        }

        return false;
    } catch {
        return false;
    }
}

function containsModeratedLink(message) {
    return findLinks(message).some(link => !isOfficialTwitchClipUrl(link));
}

module.exports = {
    containsModeratedLink,
    findLinks,
    isOfficialTwitchClipUrl
};
