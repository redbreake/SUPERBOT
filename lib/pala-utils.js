'use strict';

/**
 * Convierte la duración de un VOD de Twitch (ej: "3h25m12s", "45m10s", "1h") a milisegundos.
 * @param {string} duration
 * @returns {number} Duración en milisegundos
 */
function parseTwitchDuration(duration) {
    if (!duration || typeof duration !== 'string') return 0;
    const hoursMatch = duration.match(/(\d+)h/);
    const minutesMatch = duration.match(/(\d+)m/);
    const secondsMatch = duration.match(/(\d+)s/);

    let ms = 0;
    if (hoursMatch) ms += parseInt(hoursMatch[1], 10) * 3_600_000;
    if (minutesMatch) ms += parseInt(minutesMatch[1], 10) * 60_000;
    if (secondsMatch) ms += parseInt(secondsMatch[1], 10) * 1_000;
    return ms;
}

/**
 * Calcula la diferencia en días de calendario entre dos fechas considerando una zona horaria.
 * @param {number|Date} dateFrom Timestamp inicial
 * @param {number|Date} dateTo Timestamp final
 * @param {string} [timeZone='Europe/Madrid'] Zona horaria a utilizar
 * @returns {number} Número de días de calendario de diferencia
 */
function getCalendarDaysDiff(dateFrom, dateTo, timeZone = 'Europe/Madrid') {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const [y1, m1, d1] = formatter.format(dateFrom).split('-').map(Number);
        const [y2, m2, d2] = formatter.format(dateTo).split('-').map(Number);
        const utcMidnight1 = Date.UTC(y1, m1 - 1, d1);
        const utcMidnight2 = Date.UTC(y2, m2 - 1, d2);
        return Math.round((utcMidnight2 - utcMidnight1) / 86_400_000);
    } catch {
        const dFrom = new Date(dateFrom);
        const dTo = new Date(dateTo);
        dFrom.setHours(0, 0, 0, 0);
        dTo.setHours(0, 0, 0, 0);
        return Math.round((dTo.getTime() - dFrom.getTime()) / 86_400_000);
    }
}

/**
 * Formatea el mensaje de respuesta para el comando !pala según el estado del stream.
 * @param {Object} params
 * @param {boolean} params.isLive Si el streamer está en vivo actualmente
 * @param {number|null} params.endedAt Timestamp (ms) de finalización del último stream
 * @param {number} [params.now=Date.now()] Timestamp actual para cálculos
 * @param {string} [params.streamerName='Kala'] Nombre del streamer
 * @param {string} [params.timeZone] Zona horaria para días de calendario
 * @returns {string} Mensaje para el chat
 */
function formatPalaMessage({
    isLive = false,
    endedAt = null,
    now = Date.now(),
    streamerName = 'Kala',
    timeZone = process.env.PALA_TIMEZONE || 'Europe/Madrid'
} = {}) {
    if (isLive) {
        return `¡Pero si ${streamerName} está en directo ahora mismo agarrando la pala! ⛏️`;
    }

    if (!endedAt || !Number.isFinite(endedAt) || endedAt > now) {
        return `No encuentro ningún VOD reciente de ${streamerName} para calcular los días sin pala.`;
    }

    const calendarDays = getCalendarDaysDiff(endedAt, now, timeZone);

    // Si terminó hoy (mismo día de calendario)
    if (calendarDays <= 0) {
        const elapsedMs = Math.max(0, now - endedAt);
        const hours = Math.floor(elapsedMs / 3_600_000);
        if (hours <= 0) {
            return `¡${streamerName} terminó stream hace menos de una hora, así que hoy sí agarró la pala! ⛏️`;
        }
        const hourLabel = hours === 1 ? 'hora' : 'horas';
        return `¡${streamerName} agarró la pala hoy mismo! (hace ${hours} ${hourLabel}) ⛏️`;
    }

    // Si terminó ayer (1 día de calendario)
    if (calendarDays === 1) {
        return `${streamerName} lleva 1 día sin agarrar la pala (último stream: ayer).`;
    }

    // 2 o más días de calendario
    return `${streamerName} lleva ${calendarDays} días sin agarrar la pala.`;
}

/**
 * Consulta la API de Twitch Helix para determinar el estado de la pala con soporte de caché.
 * @param {Object} options
 * @param {Object} options.axios Cliente HTTP (axios)
 * @param {string} options.broadcasterId ID del canal en Twitch
 * @param {string} options.clientId Client ID de Twitch
 * @param {string} options.accessToken Access Token de Twitch
 * @param {string} [options.streamerName='Kala'] Nombre del streamer
 * @param {Object} [options.cache] Objeto de caché { text: string|null, timestamp: number }
 * @param {number} [options.ttlMs=60000] Tiempo de vida de la caché en milisegundos
 * @param {number} [options.now=Date.now()] Timestamp actual
 * @param {string} [options.timeZone] Zona horaria para días de calendario
 * @returns {Promise<string>}
 */
async function getPalaStatus({
    axios,
    broadcasterId,
    clientId,
    accessToken,
    streamerName = 'Kala',
    cache = null,
    ttlMs = 60_000,
    now = Date.now(),
    timeZone = process.env.PALA_TIMEZONE || 'Europe/Madrid'
}) {
    if (cache && cache.text && (now - cache.timestamp < ttlMs)) {
        return cache.text;
    }

    const headers = {
        'Client-ID': clientId,
        'Authorization': `Bearer ${accessToken}`
    };

    // 1. Comprobar si está en directo actualmente
    const streamRes = await axios.get('https://api.twitch.tv/helix/streams', {
        headers,
        params: { user_id: broadcasterId }
    });

    const isLive = Array.isArray(streamRes.data?.data) &&
        streamRes.data.data.length > 0 &&
        streamRes.data.data[0].type === 'live';

    if (isLive) {
        const message = formatPalaMessage({ isLive: true, streamerName, now, timeZone });
        if (cache) {
            cache.text = message;
            cache.timestamp = now;
        }
        return message;
    }

    // 2. Si no está en directo, buscar el último VOD archivado
    const vodRes = await axios.get('https://api.twitch.tv/helix/videos', {
        headers,
        params: {
            user_id: broadcasterId,
            type: 'archive',
            first: 1,
            sort: 'time'
        }
    });

    const lastVod = vodRes.data?.data?.[0];
    let endedAt = null;

    if (lastVod && lastVod.created_at) {
        const startedAt = Date.parse(lastVod.created_at);
        const durationMs = parseTwitchDuration(lastVod.duration);
        if (Number.isFinite(startedAt)) {
            endedAt = startedAt + durationMs;
        }
    }

    const message = formatPalaMessage({ isLive: false, endedAt, now, streamerName, timeZone });
    if (cache) {
        cache.text = message;
        cache.timestamp = now;
    }
    return message;
}

module.exports = {
    parseTwitchDuration,
    getCalendarDaysDiff,
    formatPalaMessage,
    getPalaStatus
};
