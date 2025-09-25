// =============================================================================
// ==                          BOT TODO EN UNO V2.5.3                         ==
// ==   Moderación, Duelos, Muertes, Playlist y Múltiples Juegos Adivina      ==
// =============================================================================

// --- DEPENDENCIAS ---
require('dotenv').config();
const tmi = require('tmi.js');
const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');
const axios = require('axios');
const path = require('path');

// --- CONFIGURACIÓN Y ESTADO GLOBAL ---
const config = {
    TWITCH_ACCESS_TOKEN: process.env.TWITCH_ACCESS_TOKEN,
    TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
    BOT_USERNAME: process.env.TWITCH_BOT_USERNAME,
    CHANNEL_NAME: process.env.TWITCH_CHANNEL_NAME,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    PLAYLIST_ID: process.env.PLAYLIST_ID,
    MIN_BITS_SONG: parseInt(process.env.MIN_BITS_SONG, 10) || 200,
    AUTHORIZED_USERS: (process.env.AUTHORIZED_USERS || '').toLowerCase().split(','),
};
let BOT_USER_ID = '';
let CHANNEL_ID = ''; // --> AÑADE ESTA LÍNEA: Guardaremos el ID del canal del streamer aquí
let activeReto = { isActive: false, challenger: null, challenged: null, timestamp: null };
const RETO_EXPIRATION_SECONDS = 60;
const DEATHS_FILE = path.join(__dirname, 'halo3_deaths.json');
const songQueue = [];
let isProcessingQueue = false;
let couponCount = 0;
const COUPON_BIT_PRICE = 30;
const linkWarnings = {};


// --- CLASES DE MANEJO DE DATOS ---
class DeathCounter {
    constructor() { this.loadDeaths(); }
    loadDeaths() { try { if (fs.existsSync(DEATHS_FILE)) { this.data = JSON.parse(fs.readFileSync(DEATHS_FILE, 'utf8')); } else { this.data = { deaths: 0, lastUpdated: new Date().toISOString(), game: 'juego sin nombre' }; this.saveDeaths(); } } catch (e) { console.error('Error cargando muertes:', e); this.data = { deaths: 0, lastUpdated: new Date().toISOString(), game: 'juego sin nombre' }; } }
    saveDeaths() { try { fs.writeFileSync(DEATHS_FILE, JSON.stringify(this.data, null, 2)); } catch (e) { console.error('Error guardando muertes:', e); } }
    addDeaths(amount = 1) { this.data.deaths += amount; this.data.lastUpdated = new Date().toISOString(); this.saveDeaths(); return this.data.deaths; }
    getCurrentDeaths() { return this.data.deaths; }
    resetDeaths(newCount = 0) { this.data.deaths = newCount; this.data.lastUpdated = new Date().toISOString(); this.saveDeaths(); return this.data.deaths; }
}

class ScoreTracker {
    constructor(filePath) { this.filePath = filePath; this.load(); }
    load() { try { if (fs.existsSync(this.filePath)) { this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } else { this.data = { weekStartDate: this.getThisWeeksMonday().toISOString(), scores: {} }; this.save(); } } catch (e) { console.error(`Error cargando puntuaciones de ${this.filePath}:`, e); this.data = { weekStartDate: this.getThisWeeksMonday().toISOString(), scores: {} }; } }
    save() { try { fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2)); } catch (e) { console.error(`Error guardando puntuaciones en ${this.filePath}:`, e); } }
    getThisWeeksMonday() { const today = new Date(); const day = today.getDay(); const diff = today.getDate() - day + (day === 0 ? -6 : 1); const monday = new Date(today.setDate(diff)); monday.setHours(0, 0, 0, 0); return monday; }
    checkAndResetWeek(channel) { const thisWeeksMonday = this.getThisWeeksMonday(); const storedStartDate = new Date(this.data.weekStartDate); if (storedStartDate < thisWeeksMonday) { console.log(`¡Nueva semana detectada! Reiniciando puntuaciones de ${this.filePath}.`); client.say(channel, `¡Comienza una nueva semana! Se han reiniciado las puntuaciones del juego. ¡Mucha suerte a todos!`); this.data.scores = {}; this.data.weekStartDate = thisWeeksMonday.toISOString(); this.save(); return true; } return false; }
    addScore(username, channel) { this.checkAndResetWeek(channel); this.data.scores[username] = (this.data.scores[username] || 0) + 1; this.save(); }
    getTopScores(channel, limit = 5) { this.checkAndResetWeek(channel); const scoresArray = Object.entries(this.data.scores); scoresArray.sort((a, b) => b[1] - a[1]); return scoresArray.slice(0, limit); }
}

class GuessingGame {
    constructor(filePath, gameName) { this.gameName = gameName; this.list = []; this.pool = []; this.isActive = false; this.currentItem = null; try { this.list = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { console.error(`Error al cargar ${filePath}. El juego de ${gameName} no funcionará.`, e); } }
    obfuscateName(name) { return name.replace(/[a-zA-Z0-9]/g, '_').replace(/ /g, '   '); }
    pickNewItem() { if (this.pool.length === 0) { console.log(`Rellenando la lista de ${this.gameName}...`); this.pool = [...this.list]; } const i = Math.floor(Math.random() * this.pool.length); this.currentItem = this.pool.splice(i, 1)[0]; return this.currentItem; }
    startGame(channel) { if (this.list.length === 0) { client.say(channel, `No se ha podido iniciar el juego, no hay ${this.gameName}s en la lista.`); return; } this.isActive = true; const item = this.pickNewItem(); const hint = this.obfuscateName(item.name); client.say(channel, `¡Adivina ${this.gameName}! ${item.hint} ${hint}`); }
    stopGame(channel, showAnswer = true) { if (!this.isActive) return; const answer = this.currentItem.name; this.isActive = false; this.currentItem = null; if (showAnswer) { client.say(channel, `El juego de ${this.gameName} ha terminado. La respuesta era: ${answer}.`); } }
    checkAnswer(message) { return this.isActive && this.currentItem && message.toLowerCase().includes(this.currentItem.name.toLowerCase()); }
}

// --- INSTANCIAS DE CLASES ---
const deathCounter = new DeathCounter();
const animeGame = new GuessingGame(path.join(__dirname, 'anime_list.json'), 'Caballas');
const pokemonGame = new GuessingGame(path.join(__dirname, 'pokemon.json'), 'pokémon');
const hoyoverseGame = new GuessingGame(path.join(__dirname, 'hoyoverse.json'), 'personaje de Hoyoverse');
const animeScoreTracker = new ScoreTracker(path.join(__dirname, 'anime_scores.json'));
const pokemonScoreTracker = new ScoreTracker(path.join(__dirname, 'pokemon_scores.json'));
const hoyoverseScoreTracker = new ScoreTracker(path.join(__dirname, 'hoyoverse_scores.json'));
function findLinks(message) {
    // Esta expresión regular detecta cualquier URL que empiece por http:// o https://
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return message.match(urlPattern) || [];
}

function isUserPrivileged(tags) {
    // Comprueba si el usuario es sub, mod, o el broadcaster.
    return tags.subscriber || tags.mod || tags.badges?.broadcaster === '1';
}
async function deleteChatMessage(channel, messageId) {
    try {
        await axios.delete(`https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${CHANNEL_ID}&moderator_id=${BOT_USER_ID}&message_id=${messageId}`, {
            headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` }
        });
        return true;
    } catch (error) {
        console.error(`Error al borrar mensaje ${messageId}:`, error.response?.data || error.message);
        // El bot no tiene permiso para borrar mensajes o el mensaje es muy antiguo.
        return false;
    }
}

function isAsciiArt(message) {
    // No analizar mensajes cortos
    if (message.length < 25) {
        return false;
    }

    // Contamos cuántos caracteres NO son letras, números o espacios.
    const nonAlphanumericChars = (message.match(/[^a-zA-Z0-9\s]/g) || []).length;
    
    // Calculamos el porcentaje de símbolos en el mensaje.
    const symbolPercentage = nonAlphanumericChars / message.length;

    // Si más del 65% del mensaje son símbolos, lo consideramos arte ASCII.
    // Este umbral es bueno para detectar dibujos sin afectar mensajes normales con muchos signos (ej: "holaaaaa!!!!?????").
    return symbolPercentage > 0.65;
}

// --- INICIALIZACIÓN DE CLIENTES Y FUNCIONES HELPER ---
const client = new tmi.Client({ options: { debug: true, messagesLogLevel: "info" }, connection: { reconnect: true, secure: true, capabilities: { 'twitch.tv/tags': true, 'twitch.tv/commands': true } }, identity: { username: config.BOT_USERNAME, password: `oauth:${config.TWITCH_ACCESS_TOKEN}` }, channels: [config.CHANNEL_NAME] });
const SCOPES = ['https.www.googleapis.com/auth/youtube']; const TOKEN_PATH = 'youtube_token.json'; const oauth2Client = new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI); const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
async function applyTimeout(channel, targetUsername, duration, reason) { try { const broadcasterId = (await axios.get(`https://api.twitch.tv/helix/users?login=${config.CHANNEL_NAME}`, { headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` } })).data.data[0].id; const targetUserResponse = await axios.get(`https://api.twitch.tv/helix/users?login=${targetUsername}`, { headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` } }); if (targetUserResponse.data.data.length === 0) { client.say(channel, `El usuario '${targetUsername}' no existe.`); return false } const targetUserId = targetUserResponse.data.data[0].id; await axios.post(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${BOT_USER_ID}`, { data: { user_id: targetUserId, duration: duration, reason: reason } }, { headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }); return true } catch (e) { console.error(`Error al aplicar timeout a ${targetUsername}:`, e.response ? e.response.data : e.message); client.say(channel, `Hubo un error al intentar dar timeout a @${targetUsername}.`); return false } }
function isAuthorized(username) { return config.AUTHORIZED_USERS.includes(username.toLowerCase()) }
async function getAccessToken() { try { const t = fs.readFileSync(TOKEN_PATH); oauth2Client.setCredentials(JSON.parse(t)); return true } catch (e) { return await generateNewToken() } }
async function generateNewToken() { const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES }); console.log('🔑 Autoriza esta aplicación (YouTube) visitando esta URL:', authUrl); const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); return new Promise((resolve, reject) => { rl.question('Ingresa el código de autorización: ', async (code) => { rl.close(); try { const { tokens: t } = await oauth2Client.getToken(code); oauth2Client.setCredentials(t); fs.writeFileSync(TOKEN_PATH, JSON.stringify(t)); console.log('✅ Token de YouTube guardado en', TOKEN_PATH); resolve(true) } catch (e) { console.error('❌ Error obteniendo token de YouTube:', e); reject(false) } }) }) }
function extractVideoId(url) { const p = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/; const m = url.match(p); return m ? m[1] : null }
function findYouTubeUrls(message) { const p = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/g; return message.match(p) || [] }
async function getVideoTitle(videoId) { try { const r = await youtube.videos.list({ part: 'snippet', id: videoId }); return r.data.items[0]?.snippet?.title || 'Título no disponible' } catch (e) { return 'Título no disponible' } }
async function isVideoInPlaylist(videoId) { try { let t = null; do { const r = await youtube.playlistItems.list({ part: 'snippet', playlistId: config.PLAYLIST_ID, maxResults: 50, pageToken: t }); if (r.data.items.some(i => i.snippet.resourceId.videoId === videoId)) return true; t = r.data.nextPageToken } while (t); return false } catch (e) { return false } }
async function addToPlaylist(videoId, username) { try { await youtube.playlistItems.insert({ part: 'snippet', requestBody: { snippet: { playlistId: config.PLAYLIST_ID, resourceId: { kind: 'youtube#video', videoId: videoId } } } }); return true } catch (e) { return false } }
async function processSongQueue() { if (isProcessingQueue || songQueue.length === 0) return; isProcessingQueue = true; const request = songQueue.shift(); const success = await addToPlaylist(request.videoId, request.username); if (success) { if (request.bits > 0) { const baseMsg = `🎵 ¡Gracias por los ${request.bits} bits, @${request.username}! Se agregó "${request.title}" a la playlist`; if (request.isCoupon) { let remainingMsg = `¡Quedan ${couponCount} cupones! 🎟️`; if (couponCount === 0) remainingMsg = '¡Se ha usado el último cupón!'; client.say(request.channel, `${baseMsg} usando un cupón. ${remainingMsg}`) } else { client.say(request.channel, `${baseMsg}. 💎`) } } else { client.say(request.channel, `🎵 ¡Canción "${request.title}" agregada por @${request.username}! `) } } else { client.say(request.channel, `❌ Hubo un error al agregar tu canción, @${request.username}.`) } isProcessingQueue = false }
setInterval(processSongQueue, 5000);
async function handleSongRequest(channel, tags, message, bitsAmount = 0) { const username = tags.username.toLowerCase(); let isCouponRedemption = false, canAddSong = false; if (couponCount > 0 && bitsAmount === COUPON_BIT_PRICE) { isCouponRedemption = true; canAddSong = true } else if (bitsAmount >= config.MIN_BITS_SONG) { canAddSong = true } else if (bitsAmount === 0 && isAuthorized(username) && message.toLowerCase().startsWith('!añadir')) { canAddSong = true } if (!canAddSong) return; if (isCouponRedemption) { couponCount--; } const youtubeUrls = findYouTubeUrls(message); if (youtubeUrls.length > 0) { const videoId = extractVideoId(youtubeUrls[0]); if (videoId) { if (await isVideoInPlaylist(videoId)) { client.say(channel, `🤔 La canción ya está en la playlist, @${tags.username}.`); if (isCouponRedemption) couponCount++; return } const title = await getVideoTitle(videoId); songQueue.push({ videoId: videoId, username: tags.username, channel: channel, title: title, bits: bitsAmount, isCoupon: isCouponRedemption }) } else { if (bitsAmount > 0) client.say(channel, `💎 Gracias por los ${bitsAmount} bits, @${tags.username}, pero el link no es válido.`); if (isCouponRedemption) couponCount++; } } else { if (bitsAmount > 0) client.say(channel, `💎 ¡Gracias por las ${bitsAmount} piedritas, @${tags.username}! Si quieres un video, incluye el link.`); if (isCouponRedemption) couponCount++; } }

// =============================================================================
// ==                        MANEJADORES DE EVENTOS (CORE)                      ==
// =============================================================================

client.on('cheer', (channel, userstate, message) => {
    const bits = userstate.bits;
    console.log(`[CHEER EVENT] Recibida donación de ${bits} bits de ${userstate.username}.`);
    if (bits >= 1000) { client.say(channel, `¡WOW! Muchísimas gracias por esas ${bits} piedritas, @${userstate.username}! Eres increíble ❤️`); }
    handleSongRequest(channel, userstate, message, bits);
});

async function onMessageHandler(channel, tags, message, self) {
    if (self) return;

    const messageLower = message.toLowerCase();
    const username = tags.username;
    const isMod = tags.mod || isAuthorized(username);
    
    // =================================================================
    // ==     NUEVO BLOQUE DE AUTO-MODERACIÓN ACTUALIZADO             ==
    // =================================================================

    // MÓDULO 1: Detección de Arte ASCII (Ofensa grave)
    if (isAsciiArt(message)) {
        // Borramos el mensaje usando el método fiable de la API
        await deleteChatMessage(channel, tags.id);
        
        // Timeout de 1 semana
        const reason = "Publicación de arte ASCII no permitido.";
        applyTimeout(channel, username, 604800, reason); 

        client.say(channel, `@${username}, los dibujos con símbolos (arte ASCII) no están permitidos. Has recibido un timeout de 7 días.`);
        
        return; // Detenemos el procesamiento aquí.
    }

    // MÓDULO 2: Detección de Links no autorizados
    if (findLinks(message).length > 0) {
        if (!isUserPrivileged(tags) && !tags.bits) {
            
            // Borramos el mensaje usando el método fiable de la API
            await deleteChatMessage(channel, tags.id);

            if (linkWarnings[username]) {
                // SEGUNDO AVISO: Timeout de 10 minutos
                client.say(channel, `Como segundo aviso, @${username} recibe un timeout de 10 minutos por enviar links sin permiso.`);
                applyTimeout(channel, username, 600, "Segundo aviso por enviar links sin permiso.");
                delete linkWarnings[username];
            } else {
                // PRIMER AVISO: Advertencia
                linkWarnings[username] = 1;
                client.say(channel, `@${username}, tu mensaje ha sido borrado. Para enviar links se requiere ser suscriptor o enviar Piedritas junto al mensaje.`);
            }
            
            return; // Detenemos el procesamiento aquí.
        }
    }
    // =================================================================
    // ==                  FIN DEL BLOQUE DE MODERACIÓN                 ==
    // =================================================================

    if (activeReto.isActive && username.toLowerCase() === activeReto.challenged && (messageLower === 'si' || messageLower === 'acepto' || messageLower === 'sí')) {
        const challenger = activeReto.challenger;
        const challenged = activeReto.challenged;
        
        // Desactivamos el reto inmediatamente para evitar dobles aceptaciones
        activeReto = { isActive: false, challenger: null, challenged: null, timestamp: null };
        
        client.say(channel, `¡${challenged} ha aceptado el reto de ${challenger}! La pelea comienza...`);
        
        // Esperamos 2 segundos para crear suspense
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const winner = Math.random() < 0.5 ? challenger : challenged;
        const loser = winner === challenger ? challenged : challenger;
        
        let duration = 30; // Duración normal del timeout
        // 1% de probabilidad de golpe crítico para un timeout de 10 minutos
        if (Math.random() < 0.11) { 
            duration = 1200; 
            client.say(channel, `💥 ¡GOLPE CRÍTICO! 💥`); 
        }
        
        client.say(channel, `¡${winner} ha derrotado a ${loser}! Como castigo, @${loser} recibe un timeout de ${duration} segundos.`);
        await applyTimeout(channel, loser, duration, `Perdió el reto contra ${winner}.`);
        
        return; // Detenemos el procesamiento aquí porque ya se ha manejado el mensaje
    }

    // Lógica para adivinar juegos
    if (animeGame.checkAnswer(messageLower)) { const winner = username; const animeName = animeGame.currentItem.name; animeScoreTracker.addScore(winner, channel); client.say(channel, `🎉 ¡Correcto! @${winner} ha adivinado  "${animeName}"! Preparando el siguiente...`); animeGame.stopGame(channel, false); setTimeout(() => animeGame.startGame(channel), 3000); return; }
    if (pokemonGame.checkAnswer(messageLower)) { const winner = username; const pokemonName = pokemonGame.currentItem.name; pokemonScoreTracker.addScore(winner, channel); client.say(channel, `🎉 ¡Atrápalo ya! @${winner} ha adivinado que era "${pokemonName}"! Preparando el siguiente...`); pokemonGame.stopGame(channel, false); setTimeout(() => pokemonGame.startGame(channel), 3000); return; }
    if (hoyoverseGame.checkAnswer(messageLower)) { const winner = username; const hoyoName = hoyoverseGame.currentItem.name; hoyoverseScoreTracker.addScore(winner, channel); client.say(channel, `✨ ¡Correcto! @${winner} ha adivinado que era "${hoyoName}"! Preparando el siguiente...`); hoyoverseGame.stopGame(channel, false); setTimeout(() => hoyoverseGame.startGame(channel), 3000); return; }
    
    if (activeReto.isActive && username.toLowerCase() === activeReto.challenged && (messageLower === 'si' || messageLower === 'acepto' || messageLower === 'sí')) { /*...*/ }
    if (message.trim() === 'M' && isAuthorized(username)) { const newDeathCount = deathCounter.addDeaths(1); client.say(channel, `!cmd edit muertes Muertes en ${deathCounter.data.game}: ${newDeathCount}`); return }

    if (!message.startsWith('!')) return;
    const [command, ...args] = message.slice(1).split(' ');
    const commandLower = command.toLowerCase();

    switch (commandLower) {
        // == Comandos de Moderación ==
        case 'k': {
            if (!isMod) return;
            const target = args[0]?.replace('@', '');
            const duration = args[1] || 600;
            const reason = args.slice(2).join(' ') || 'Timeout ejecutado por el bot.';
            if (!target) { client.say(channel, "Uso: !k <usuario> [duración] [razón]"); return }
            if (await applyTimeout(channel, target, duration, reason)) { client.say(channel, `El usuario @${target} ha recibido un timeout de ${duration} segundos.`); }
            break;
        }
        case 'u': {
            if (!isMod) return;
            const targetUsername = args[0]?.replace('@', '');
            if (!targetUsername) { client.say(channel, "Uso: !u <usuario>"); return; }
            try {
                const broadcasterId = (await axios.get(`https://api.twitch.tv/helix/users?login=${config.CHANNEL_NAME}`, { headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` } })).data.data[0].id;
                const targetUserResponse = await axios.get(`https://api.twitch.tv/helix/users?login=${targetUsername}`, { headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` } });
                if (targetUserResponse.data.data.length === 0) { client.say(channel, `El usuario '${targetUsername}' no existe.`); break; }
                const targetUserId = targetUserResponse.data.data[0].id;
                await axios.delete(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${BOT_USER_ID}&user_id=${targetUserId}`, { headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` } });
                client.say(channel, `Se ha quitado el ban/timeout al usuario @${targetUsername}.`);
            } catch (e) { console.error(`Error al quitar timeout a ${targetUsername}:`, e.response ? e.response.data : e.message); client.say(channel, `Hubo un error al intentar quitar el timeout a @${targetUsername}.`); }
            break;
        }
        case 'title': {
            const newTitle = args.join(' ');

            // SI hay texto después del comando (función de MODERADOR)
            if (newTitle) {
                if (!isMod) return; // Si no es mod, no hace nada
                client.say(channel, `!settitle ${newTitle}`);
            } 
            // SI NO hay texto (función para TODOS)
            else {
                try {
                    const response = await axios.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${CHANNEL_ID}`, {
                        headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` }
                    });
                    if (response.data.data.length > 0) {
                        const currentTitle = response.data.data[0].title;
                        client.say(channel, `El título actual del directo es: ${currentTitle}`);
                    }
                } catch (error) {
                    console.error("Error al obtener el título:", error.response?.data || error.message);
                    client.say(channel, "No se pudo obtener la información del stream.");
                }
            }
            break;
        }

        case 'game': {
            const newGame = args.join(' ');

            // SI hay texto después del comando (función de MODERADOR)
            if (newGame) {
                if (!isMod) return; // Si no es mod, no hace nada
                client.say(channel, `!setgame ${newGame}`);
            }
            // SI NO hay texto (función para TODOS)
            else {
                try {
                    const response = await axios.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${CHANNEL_ID}`, {
                        headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` }
                    });
                    if (response.data.data.length > 0) {
                        const currentGame = response.data.data[0].game_name;
                        client.say(channel, `El juego actual del directo es: ${currentGame}`);
                    }
                } catch (error) {
                    console.error("Error al obtener el juego:", error.response?.data || error.message);
                    client.say(channel, "No se pudo obtener la información del stream.");
                }
            }
            break;
        }
        

        case 'hoy': {
            try {
                const response = await axios.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${CHANNEL_ID}`, {
                    headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` }
                });
                if (response.data.data.length > 0) {
                    const currentTitle = response.data.data[0].title;
                    client.say(channel, `El título es: ${currentTitle}`);
                }
            } catch (error) {
                console.error("Error al obtener el título:", error.response?.data || error.message);
                client.say(channel, "No se pudo obtener el título del directo.");
            }
            break;
        }
        case 'settitulo': {
            if (!isMod) return;
            const newTitle = args.join(' ');
            if (!newTitle) {
                client.say(channel, "Uso: !settitulo <nuevo título del directo>");
                return;
            }

            try {
                await axios.patch(`https://api.twitch.tv/helix/channels?broadcaster_id=${CHANNEL_ID}`, 
                    { title: newTitle },
                    { headers: { 
                        'Client-ID': config.TWITCH_CLIENT_ID, 
                        'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }}
                );
                client.say(channel, `✅ ¡Título actualizado! Nuevo título: ${newTitle}`);
            } catch (error) {
                console.error("Error al cambiar el título:", error.response?.data || error.message);
                client.say(channel, "❌ Hubo un error al intentar cambiar el título. Revisa los permisos del token.");
            }
            break;
        }
        
        // == Comandos de Duelo y Muertes ==
        case 'reto': {
            if (activeReto.isActive && (Date.now() - activeReto.timestamp) / 1000 < RETO_EXPIRATION_SECONDS) { client.say(channel, `Ya hay un reto activo.`); return }
            const target = args[0]?.replace('@', '').toLowerCase();
            if (!target) { client.say(channel, "Uso: !reto <usuario>"); return }
            if (target === username.toLowerCase()) { client.say(channel, "No puedes retarte a ti mismo."); return }
            activeReto = { isActive: true, challenger: username, challenged: target, timestamp: Date.now() };
            client.say(channel, `¡Atención! @${username} ha retado a un duelo a @${target}. Escribe "si" o "acepto" para pelear.`);
            break;
        }
        case 'muertes':
            client.say(channel, `💀 Muertes actuales en ${deathCounter.data.game}: ${deathCounter.getCurrentDeaths()}`);
            break;
        case 'resetmuertes': {
            if (!isAuthorized(username)) return;
            const newCount = args.length > 0 ? parseInt(args[0]) : 0;
            if (!isNaN(newCount) && newCount >= 0) {
                deathCounter.resetDeaths(newCount);
                client.say(channel, `!cmd edit muertes Muertes en ${deathCounter.data.game}: ${newCount}`);
                client.say(channel, `🔄 Contador de muertes reseteado a: ${newCount}`);
            } else { client.say(channel, `❌ Número inválido.`); }
            break;
        }
        case '+muertes': {
            if (!isAuthorized(username)) return;
            const amount = args.length > 0 ? parseInt(args[0]) : 1;
            if (!isNaN(amount) && amount > 0) {
                const newDeathCount = deathCounter.addDeaths(amount);
                client.say(channel, `!cmd edit muertes Muertes en ${deathCounter.data.game}: ${newDeathCount}`);
                client.say(channel, `💀 +${amount} muertes agregadas! Total: ${newDeathCount}`);
            } else { client.say(channel, `❌ Número inválido.`); }
            break;
        }
        
        // == Comandos de Juegos ==
        case 'adivina': if (isMod) animeGame.isActive ? client.say(channel, 'El juego ya está en marcha.') : animeGame.startGame(channel); break;
        case 'parar': if (isMod) animeGame.stopGame(channel); break;
        case 'tops': const topAnime = animeScoreTracker.getTopScores(channel, 5); if (topAnime.length === 0) { client.say(channel, 'Nadie ha adivinado animes esta semana.'); } else { const l = topAnime.map((e, i) => `${i + 1}. ${e[0]} (${e[1]})`).join(' | '); client.say(channel, `🏆 Top 5 Anime: ${l}`); } break;
        case 'pokemon': if (isMod) pokemonGame.isActive ? client.say(channel, 'El juego de Pokémon ya está en marcha.') : pokemonGame.startGame(channel); break;
        case 'pararpkm': if (isMod) pokemonGame.stopGame(channel); break;
        case 'topspkm': const topPkm = pokemonScoreTracker.getTopScores(channel, 5); if (topPkm.length === 0) { client.say(channel, 'Nadie ha adivinado Pokémon esta semana.'); } else { const l = topPkm.map((e, i) => `${i + 1}. ${e[0]} (${e[1]})`).join(' | '); client.say(channel, `🏆 Top 5 Pokémon: ${l}`); } break;
        case 'hoyoverse': if (isMod) hoyoverseGame.isActive ? client.say(channel, 'El juego de Hoyoverse ya está en marcha.') : hoyoverseGame.startGame(channel); break;
        case 'pararhoyo': if (isMod) hoyoverseGame.stopGame(channel); break;
        case 'topshoyo': const topHoyo = hoyoverseScoreTracker.getTopScores(channel, 5); if (topHoyo.length === 0) { client.say(channel, 'Nadie ha acertado personajes de Hoyoverse esta semana.'); } else { const l = topHoyo.map((e, i) => `${i + 1}. ${e[0]} (${e[1]})`).join(' | '); client.say(channel, `🏆 Top 5 Hoyoverse: ${l}`); } break;

        // == Comandos de Playlist ==
        case 'añadir': handleSongRequest(channel, tags, message, 0); break;
        case 'cupon': if (isAuthorized(username)) { const a = parseInt(args[0], 10); if (!isNaN(a) && a > 0) { couponCount = a; client.say(channel, `🎟️ ¡CUPÓN ACTIVADO! Las próximas ${couponCount} canciones por ${COUPON_BIT_PRICE} piedritas serán aceptadas.`); } } break;
        case 'playlist': if (config.PLAYLIST_ID) client.say(channel, `Playlist: https://www.youtube.com/playlist?list=${config.PLAYLIST_ID}`); break;
        case 'comandos': client.say(channel, `Stream: !hoy, !settitulo | Juegos: !adivina, !pokemon, !hoyoverse | Tops: !tops, !topspkm, !topshoyo | Música: !playlist | Otros: !reto, !muertes.`); break;
    }
}

/// =============================================================================
// ==                         INICIO DEL BOT Y CIERRE                         ==
// =============================================================================

async function startBot() {
    // 1. Autenticar con YouTube (si está configurado)
    if (config.GOOGLE_CLIENT_ID) { 
        if (await getAccessToken()) { 
            console.log("[v] Módulo de Playlist de YouTube cargado."); 
        } else { 
            console.warn("⚠️  Advertencia: Playlist de YouTube no funcionará."); 
        }
    } else { 
        console.log("[ ] Módulo de Playlist de YouTube desactivado."); 
    }

    // 2. Conectar al chat de Twitch
    client.on('connected', (addr, port) => {
        console.log(`\n* Conectado a ${addr}:${port}`);
    });
    await client.connect().catch(console.error);

    // 3. OBTENER IDs DESPUÉS de conectar (¡Ahora con el token correcto!)
    try {
        const botUserResponse = await axios.get(`https://api.twitch.tv/helix/users?login=${config.BOT_USERNAME}`, {
            headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` }
        });
        BOT_USER_ID = botUserResponse.data.data[0].id;

        const channelUserResponse = await axios.get(`https://api.twitch.tv/helix/users?login=${config.CHANNEL_NAME}`, {
            headers: { 'Client-ID': config.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}` }
        });
        CHANNEL_ID = channelUserResponse.data.data[0].id;

    } catch (error) {
        console.error("❌ Error fatal: No se pudo obtener el ID del bot o del canal.");
        console.error("👉 CAUSA PROBABLE: Tu TWITCH_ACCESS_TOKEN en el .env es inválido o tiene el prefijo 'oauth:'.");
        console.error("   (Detalle del error de la API:", error.response?.data?.message || error.message, ")");
        process.exit(1);
    }
    
    // 4. AHORA que tenemos todo, mostramos el mensaje de bienvenida completo
    console.log(`* Corriendo como '${config.BOT_USERNAME}' (ID: ${BOT_USER_ID})`);
    console.log(`* Escuchando en el canal '${config.CHANNEL_NAME}' (ID: ${CHANNEL_ID})`);
    console.log(`--- Módulos Cargados ---`);
    console.log(`[v] Moderación, Duelos, Muertes`);
    console.log(`[v] Gestión de Stream (!hoy, !settitulo)`);
    console.log(`[v] Juego de Anime (${animeGame.list.length} cargados)`);
    console.log(`[v] Juego de Pokémon (${pokemonGame.list.length} cargados)`);
    console.log(`[v] Juego de Hoyoverse (${hoyoverseGame.list.length} cargados)`);
    console.log(`------------------------`);
    client.say(config.CHANNEL_NAME, "Bot multifunción V2.7.1 listo para la acción.");
}

// Vinculamos los manejadores
client.on('message', onMessageHandler);
process.on('SIGINT', () => { console.log('\n🛑 Cerrando bot...'); client.disconnect(); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n🛑 Cerrando bot...'); client.disconnect(); process.exit(0); });

// ¡Iniciamos el bot!
startBot();