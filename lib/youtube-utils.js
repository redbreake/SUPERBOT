'use strict';

const VIDEO_ID_PATTERN = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/|m\.youtube\.com\/watch\?v=|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/;
const YOUTUBE_URL_PATTERN = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w&?=-]+/g;

function extractVideoId(url) {
    const match = url.match(VIDEO_ID_PATTERN);
    return match ? match[1] : null;
}

function findYouTubeUrls(message) {
    return message.match(YOUTUBE_URL_PATTERN) || [];
}

module.exports = { extractVideoId, findYouTubeUrls };
