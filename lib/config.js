'use strict';

const REQUIRED_TWITCH_KEYS = [
    'TWITCH_ACCESS_TOKEN',
    'TWITCH_CLIENT_ID',
    'BOT_USERNAME',
    'CHANNEL_NAME',
];

const YOUTUBE_KEYS = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'PLAYLIST_ID',
];

function validateConfig(config) {
    const errors = [];
    const missingTwitch = REQUIRED_TWITCH_KEYS.filter(key => !config[key]);

    if (missingTwitch.length > 0) {
        errors.push(`Faltan variables obligatorias de Twitch: ${missingTwitch.join(', ')}`);
    }

    const configuredYouTubeKeys = YOUTUBE_KEYS.filter(key => Boolean(config[key]));
    if (configuredYouTubeKeys.length > 0 && configuredYouTubeKeys.length !== YOUTUBE_KEYS.length) {
        const missingYouTube = YOUTUBE_KEYS.filter(key => !config[key]);
        errors.push(`La configuración de YouTube está incompleta: faltan ${missingYouTube.join(', ')}`);
    }

    if (!Number.isInteger(config.MIN_BITS_SONG) || config.MIN_BITS_SONG <= 0) {
        errors.push('MIN_BITS_SONG debe ser un número entero mayor que 0');
    }

    return errors;
}

module.exports = { validateConfig };
