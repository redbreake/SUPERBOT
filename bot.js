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
const express = require('express');



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
const DEATHS_FILE = path.join(__dirname, 'silksong_deaths.json');
const songQueue = [];
let isProcessingQueue = false;
let couponCount = 0;
const COUPON_BIT_PRICE = 30;
const linkWarnings = {};
// --> AÑADE ESTAS DOS LÍNEAS
const linkPermits = {}; // Guardará los permisos temporales para links
const PERMA_WHITELIST_USERS = ['kawada_tenshi', 'shikijoumadame', 'redbreakebot', 'kalaa']; // Usuarios inmunes a la auto-moderación
let commandEditorState = {
    isActive: false,
    commandName: null,
    currentContent: null,
    editorUsername: null
};
// Estado para el Duelo del Oeste (1vs1 de reflejos)
let westernDuel = {
    step: 0, // 0: Inactivo, 1: Esperando Aceptar, 2: Tensión (Pre-Bang), 3: Disparo (Bang)
    challenger: null,
    target: null,
    timer: null
};



// --- CLASES DE MANEJO DE DATOS ---
class DeathCounter {
    constructor() { this.loadDeaths(); }
    loadDeaths() { try { if (fs.existsSync(DEATHS_FILE)) { this.data = JSON.parse(fs.readFileSync(DEATHS_FILE, 'utf8')); } else { this.data = { deaths: 0, lastUpdated: new Date().toISOString(), game: 'Silksong' }; this.saveDeaths(); } } catch (e) { console.error('Error cargando muertes:', e); this.data = { deaths: 0, lastUpdated: new Date().toISOString(), game: 'Silksong' }; } }
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

class KaraokeSystem {
    constructor(lyricsDir) {
        this.lyricsDir = lyricsDir;
        this.activeTimeouts = [];
        this.isPlaying = false;
        this.currentSong = null;
    }

    loadLrc(filename) {
        const filePath = path.join(this.lyricsDir, filename.endsWith('.lrc') ? filename : `${filename}.lrc`);
        if (!fs.existsSync(filePath)) return null;

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const lyrics = [];

        // Regex para capturar [mm:ss.ms] o [mm:ss] y el texto
        const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;

        for (const line of lines) {
            const match = line.match(timeRegex);
            if (match) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const ms = match[3] ? parseInt(match[3].padEnd(3, '0').substring(0, 3)) : 0;

                const totalMs = (minutes * 60 * 1000) + (seconds * 1000) + ms;
                const text = match[4].trim();

                if (text) { // Solo añadir si hay texto
                    lyrics.push({ time: totalMs, text: text });
                }
            }
        }
        return lyrics.sort((a, b) => a.time - b.time);
    }

    play(channel, filename) {
        this.stop(); // Detener cualquier canción anterior

        const lyrics = this.loadLrc(filename);
        if (!lyrics) return false;

        this.isPlaying = true;
        this.currentSong = filename;
        client.say(channel, `🎤 Iniciando Karaoke: ${filename} 🎶`);

        const startTime = Date.now();

        lyrics.forEach(line => {
            const timeoutId = setTimeout(() => {
                if (this.isPlaying) {
                    client.say(channel, `🎶 ${line.text}`);
                }
            }, line.time);
            this.activeTimeouts.push(timeoutId);
        });

        // Timeout final para limpiar estado
        const lastLineTime = lyrics[lyrics.length - 1].time;
        const endTimeout = setTimeout(() => {
            this.stop(false); // False para no decir "detenido por usuario"
            client.say(channel, `🎤 Fin de la canción. 👏👏👏`);
        }, lastLineTime + 2000);
        this.activeTimeouts.push(endTimeout);

        return true;
    }

    stop(notify = true) {
        if (!this.isPlaying) return false;

        this.activeTimeouts.forEach(id => clearTimeout(id));
        this.activeTimeouts = [];
        this.isPlaying = false;
        this.currentSong = null;

        return true;
    }
}

const karaoke = new KaraokeSystem(path.join(__dirname, 'lyrics'));
async function buildPyramid(channel, emote, size) {
    const delay = 200; // 1.5 segundos de pausa para evitar el spam-filter de Twitch

    // Parte ascendente de la pirámide
    for (let i = 1; i <= size; i++) {
        const line = (emote + ' ').repeat(i).trim();
        client.say(channel, line);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Parte descendente de la pirámide
    for (let i = size - 1; i >= 1; i--) {
        const line = (emote + ' ').repeat(i).trim();
        client.say(channel, line);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
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
async function getAccessToken() {
    try {
        // Primero intentamos leer desde variable de entorno (para Render/Servidores)
        if (process.env.YOUTUBE_TOKEN_JSON) {
            const token = JSON.parse(process.env.YOUTUBE_TOKEN_JSON);
            oauth2Client.setCredentials(token);
            console.log("✅ Token de YouTube cargado desde variable de entorno.");
            return true;
        }

        // Luego intentamos leer el archivo local
        if (fs.existsSync(TOKEN_PATH)) {
            const t = fs.readFileSync(TOKEN_PATH);
            oauth2Client.setCredentials(JSON.parse(t));
            return true;
        }

        // Si no hay nada, solo intentamos generar si es interactivo
        if (process.stdin.isTTY) {
            return await generateNewToken();
        } else {
            console.warn("⚠️ No se encontró token de YouTube y el entorno no es interactivo.");
            return false;
        }
    } catch (e) {
        console.error("❌ Error en getAccessToken:", e.message);
        return false;
    }
}
async function generateNewToken() { const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES }); console.log('🔑 Autoriza esta aplicación (YouTube) visitando esta URL:', authUrl); const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); return new Promise((resolve, reject) => { rl.question('Ingresa el código de autorización: ', async (code) => { rl.close(); try { const { tokens: t } = await oauth2Client.getToken(code); oauth2Client.setCredentials(t); fs.writeFileSync(TOKEN_PATH, JSON.stringify(t)); console.log('✅ Token de YouTube guardado en', TOKEN_PATH); resolve(true) } catch (e) { console.error('❌ Error obteniendo token de YouTube:', e); reject(false) } }) }) }
function extractVideoId(url) {
    const p = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/|m\.youtube\.com\/watch\?v=|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/;
    const m = url.match(p);
    return m ? m[1] : null;
}
function findYouTubeUrls(message) {
    const p = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w-&?=]+/g;
    return message.match(p) || [];
}
async function getVideoTitle(videoId) { try { const r = await youtube.videos.list({ part: 'snippet', id: videoId }); return r.data.items[0]?.snippet?.title || 'Título no disponible' } catch (e) { return 'Título no disponible' } }
async function isVideoInPlaylist(videoId) { try { let t = null; do { const r = await youtube.playlistItems.list({ part: 'snippet', playlistId: config.PLAYLIST_ID, maxResults: 50, pageToken: t }); if (r.data.items.some(i => i.snippet.resourceId.videoId === videoId)) return true; t = r.data.nextPageToken } while (t); return false } catch (e) { return false } }
async function addToPlaylist(videoId, username) { try { await youtube.playlistItems.insert({ part: 'snippet', requestBody: { snippet: { playlistId: config.PLAYLIST_ID, resourceId: { kind: 'youtube#video', videoId: videoId } } } }); return true } catch (e) { return false } }
async function processSongQueue() { if (isProcessingQueue || songQueue.length === 0) return; isProcessingQueue = true; const request = songQueue.shift(); const success = await addToPlaylist(request.videoId, request.username); if (success) { if (request.bits > 0) { const baseMsg = `🎵 ¡Gracias por los ${request.bits} bits, @${request.username}! Se agregó "${request.title}" a la playlist`; if (request.isCoupon) { let remainingMsg = `¡Quedan ${couponCount} cupones! 🎟️`; if (couponCount === 0) remainingMsg = '¡Se ha usado el último cupón!'; client.say(request.channel, `${baseMsg} usando un cupón. ${remainingMsg}`) } else { client.say(request.channel, `${baseMsg}. 💎`) } } else { client.say(request.channel, `🎵 ¡Canción "${request.title}" agregada por @${request.username}! `) } } else { client.say(request.channel, `❌ Hubo un error al agregar tu canción, @${request.username}.`) } isProcessingQueue = false }
setInterval(processSongQueue, 5000);
async function handleSongRequest(channel, tags, message, bitsAmount = 0) {
    const username = tags.username.toLowerCase();
    let isCouponRedemption = false, canAddSong = false;

    console.log(`[SONG REQUEST] De: ${username} | Bits: ${bitsAmount} | Cupones actuales: ${couponCount}`);

    if (couponCount > 0 && (Number(bitsAmount) == Number(COUPON_BIT_PRICE))) {
        isCouponRedemption = true;
        canAddSong = true;
        console.log(`[SONG REQUEST] Redención de cupón detectada.`);
    } else if (Number(bitsAmount) >= Number(config.MIN_BITS_SONG)) {
        canAddSong = true;
    } else if (bitsAmount === 0 && isAuthorized(username) && message.toLowerCase().startsWith('!añadir')) {
        canAddSong = true;
    }

    if (!canAddSong) {
        if (bitsAmount > 0) console.log(`[SONG REQUEST] Bits insuficientes para canción o cupón (${bitsAmount}).`);
        return;
    }

    if (isCouponRedemption) {
        couponCount--;
    }

    const youtubeUrls = findYouTubeUrls(message);
    if (youtubeUrls.length > 0) {
        const videoId = extractVideoId(youtubeUrls[0]);
        console.log(`[SONG REQUEST] URL detectada: ${youtubeUrls[0]} | VideoID: ${videoId}`);

        if (videoId) {
            if (await isVideoInPlaylist(videoId)) {
                client.say(channel, `🤔 La canción ya está en la playlist, @${tags.username}.`);
                if (isCouponRedemption) {
                    couponCount++;
                    console.log(`[SONG REQUEST] Canción duplicada. Cupón devuelto. Cupones: ${couponCount}`);
                }
                return;
            }
            const title = await getVideoTitle(videoId);
            songQueue.push({ videoId: videoId, username: tags.username, channel: channel, title: title, bits: bitsAmount, isCoupon: isCouponRedemption });
        } else {
            if (bitsAmount > 0) {
                if (!isCouponRedemption) {
                    client.say(channel, `💎 Gracias por los ${bitsAmount} bits, @${tags.username}, pero el link no es válido.`);
                }
                console.log(`[SONG REQUEST] Link inválido.`);
            }
            if (isCouponRedemption) {
                couponCount++;
                console.log(`[SONG REQUEST] Link inválido. Cupón devuelto. Cupones: ${couponCount}`);
            }
        }
    } else {
        if (bitsAmount > 0) {
            if (!isCouponRedemption) {
                client.say(channel, `💎 ¡Gracias por las ${bitsAmount} piedritas, @${tags.username}! Si quieres un video, incluye el link.`);
            }
            console.log(`[SONG REQUEST] No se encontró link en el mensaje.`);
        }
        if (isCouponRedemption) {
            couponCount++;
            console.log(`[SONG REQUEST] Mensaje sin link. Cupón devuelto. Cupones: ${couponCount}`);
        }
    }
}

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
    // ==   BLOQUE PARA EL ATAJO DE EDICIÓN (+) - VERSIÓN INSTANTÁNEA   ==
    // =================================================================
    if (message.startsWith('+') && commandEditorState.isActive) {
        if (!isMod) {
            return; // Ignoramos si no es mod
        }

        const textToAdd = message.slice(1).trim();
        if (!textToAdd) {
            return; // Ignoramos si no hay texto que añadir
        }

        // --- LÓGICA MODIFICADA (INSTANTÁNEA) ---

        // 1. Construimos el nuevo contenido completo
        const newContent = `${commandEditorState.currentContent} ${textToAdd}`;

        // 2. ENVIAMOS EL COMANDO DE EDICIÓN INMEDIATAMENTE
        client.say(channel, `!cmd edit ${commandEditorState.commandName} ${newContent}`);

        // 3. ACTUALIZAMOS el contenido en memoria para el siguiente '+'
        commandEditorState.currentContent = newContent;

        // 4. Damos feedback al mod de que la acción se ha completado
        //client.say(channel, `Comando ${commandEditorState.commandName} actualizado por @${username}.`);

        // NOTA: NO reseteamos el estado de edición aquí.
        // El modo edición sigue activo para poder añadir más cosas.

        return; // Detenemos el procesamiento para que no se active nada más
    }
    // =================================================================
    // ==                     FIN DEL BLOQUE (+)                      ==
    // =================================================================
    // Reemplaza el bloque de auto-moderación que ya tienes con este:
    // =================================================================
    // ==          LÓGICA DEL DUELO DEL OESTE (1 vs 1)                ==
    // =================================================================

    // Solo procesamos si hay un duelo activo y habla uno de los participantes
    if (westernDuel.step > 0 && (username.toLowerCase() === westernDuel.challenger || username.toLowerCase() === westernDuel.target)) {

        // FASE 1: Aceptar el duelo
        if (westernDuel.step === 1 && username.toLowerCase() === westernDuel.target) {
            if (messageLower === 'si' || messageLower === 'acepto' || messageLower === 'sí' || messageLower === 'gogogo') {
                westernDuel.step = 2; // Pasamos a fase de tensión
                client.say(channel, `⚔️ Duelo aceptado. Miradas fijas... manos en la cartuchera... (Escribid BANG a mi señal)`);

                // Tiempo aleatorio entre 3 y 10 segundos
                const delay = Math.floor(Math.random() * 7000) + 3000;

                westernDuel.timer = setTimeout(() => {
                    if (westernDuel.step === 2) { // Si nadie disparó antes de tiempo
                        westernDuel.step = 3; // FASE DE DISPARO
                        client.say(channel, "🔫 ¡¡¡ BANG !!! 🔫");

                        // Si nadie dispara en 10 segundos, se cancela
                        setTimeout(() => {
                            if (westernDuel.step === 3) {
                                client.say(channel, "💨 Se os han mojado las pólvoras. Nadie disparó.");
                                westernDuel = { step: 0, challenger: null, target: null, timer: null };
                            }
                        }, 10000);
                    }
                }, delay);
            }
            return;
        }

        // FASE 2: Falsa Salida (Disparar antes del BANG)
        if (westernDuel.step === 2 && messageLower === 'bang') {
            clearTimeout(westernDuel.timer); // Cancelamos el BANG del bot

            client.say(channel, `🚫 ¡Falsa salida! @${username} se puso nervioso y disparó al suelo. Pierdes el duelo.`);
            await applyTimeout(channel, username, 30, "Falsa salida en duelo del oeste");

            // El otro gana automáticamente
            const winner = (username.toLowerCase() === westernDuel.challenger) ? westernDuel.target : westernDuel.challenger;
            client.say(channel, `🏆 @${winner} gana por descalificación.`);

            westernDuel = { step: 0, challenger: null, target: null, timer: null };
            return;
        }

        // FASE 3: Disparo Real (El primero que escribe BANG gana)
        if (westernDuel.step === 3 && messageLower === 'bang') {
            // 1. ¡IMPORTANTE! Cerramos el duelo INMEDIATAMENTE para que nadie más pueda ganar.
            // Al poner step en 0 aquí, bloqueamos cualquier mensaje que llegue 1 milisegundo después.
            westernDuel.step = 0;
            clearTimeout(westernDuel.timer); // Cancelamos el temporizador de "nadie disparó"

            const winner = username;
            const loser = (winner.toLowerCase() === westernDuel.challenger) ? westernDuel.target : westernDuel.challenger;

            // 2. Anunciamos al ganador
            client.say(channel, `🤠 🔫 ¡POW! @${winner} ha sido más rápido. @${loser} cae al suelo.`);

            // 3. Aplicamos el castigo (ahora da igual si tarda, el duelo ya está cerrado)
            applyTimeout(channel, loser, 30, `Perdió el duelo del oeste contra ${winner}`).catch(err => console.error("Error en timeout duelo:", err));

            // Limpiamos el resto de variables
            westernDuel = { step: 0, challenger: null, target: null, timer: null };
            return;
        }
    }
    // =================================================================
    // =================================================================
    // =================================================================
    // ==     BLOQUE DE AUTO-MODERACIÓN ACTUALIZADO (v2)              ==
    // =================================================================

    // EXCEPCIÓN PERMANENTE: Si el usuario está en la whitelist, ignoramos toda la auto-moderación.
    if (PERMA_WHITELIST_USERS.includes(username.toLowerCase())) {
        // No hacemos nada, el mensaje pasa limpio.
    } else {
        // MÓDULO 1: Detección de Arte ASCII
        if (isAsciiArt(message)) {
            await deleteChatMessage(channel, tags.id);
            const reason = "Publicación de arte ASCII no permitido.";
            applyTimeout(channel, username, 604800, reason);
            client.say(channel, `@${username}, los dibujos con símbolos (arte ASCII) no están permitidos. Has recibido un timeout de 7 días.`);
            return;
        }

        // MÓDULO 2: Detección de Links
        if (findLinks(message).length > 0) {
            // Comprobamos si el usuario NO tiene privilegios (sub/mod/bits)
            if (!isUserPrivileged(tags) && !tags.bits) {

                // EXCEPCIÓN TEMPORAL: Comprobamos si el usuario tiene un !permit activo
                if (linkPermits[username] && Date.now() < linkPermits[username]) {
                    // El permiso es válido, así que lo consumimos y dejamos pasar el mensaje.
                    delete linkPermits[username]; // El permiso es de un solo uso.
                    client.say(channel, `Permiso de link utilizado por @${username}.`);
                    // Dejamos que el mensaje continúe para que pueda ser procesado por otros módulos si es necesario.
                } else {
                    // Si no tiene permiso, aplicamos la moderación
                    await deleteChatMessage(channel, tags.id);

                    if (linkWarnings[username]) {
                        // SEGUNDO AVISO: Timeout
                        client.say(channel, `Como segundo aviso, @${username} recibe un timeout de 10 minutos por enviar links sin permiso.`);
                        applyTimeout(channel, username, 600, "Segundo aviso por enviar links sin permiso.");
                        delete linkWarnings[username];
                    } else {
                        // PRIMER AVISO: Advertencia
                        linkWarnings[username] = 1;
                        client.say(channel, `@${username}, tu mensaje ha sido borrado. Para enviar links se requiere ser suscriptor, usar Bits o recibir un !permit de un moderador.`);
                    }
                    return; // Detenemos el procesamiento del mensaje aquí.
                }
            }
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

        case 'permit': {
            if (!isMod) return;

            const targetUsername = args[0]?.replace('@', '').toLowerCase();
            if (!targetUsername) {
                client.say(channel, "Uso: !permit <usuario>");
                return;
            }

            // Damos un permiso de 60 segundos desde el momento actual
            const expirationTime = Date.now() + 60000; // 60 segundos en milisegundos
            linkPermits[targetUsername] = expirationTime;

            client.say(channel, `✅ @${targetUsername} tiene permiso para enviar un link durante los próximos 60 segundos.`);
            break;
        }
        // ... dentro del switch ...
        // == COMANDO PARA INICIAR EL DUELO 1vs1 ==
        case 'duelo':
        case 'desenfundar': {
            // Verificamos si ya hay un duelo de este tipo activo
            if (westernDuel.step > 0) {
                client.say(channel, `Ya hay un duelo en curso entre @${westernDuel.challenger} y @${westernDuel.target}. Esperad vuestro turno.`);
                return;
            }

            // Obtenemos el objetivo
            const targetUser = args[0]?.replace('@', '').toLowerCase();

            if (!targetUser) {
                client.say(channel, "Uso: !duelo @usuario (para retar a reflejos)");
                return;
            }

            if (targetUser === username.toLowerCase()) {
                client.say(channel, "No puedes tener un duelo contigo mismo, vaquero.");
                return;
            }

            // Iniciamos el estado
            westernDuel = {
                step: 1, // Esperando aceptación
                challenger: username.toLowerCase(),
                target: targetUser,
                timer: null
            };

            client.say(channel, `🌵 @${username} desafía a @${targetUser} a un duelo de reflejos. @${targetUser}, escribe "si" o "acepto" para desenfundar.`);

            // Si no acepta en 30 segundos, se cancela
            setTimeout(() => {
                if (westernDuel.step === 1 && westernDuel.target === targetUser) {
                    client.say(channel, `El duelo entre @${username} y @${targetUser} ha caducado. Se ve que alguien tuvo miedo... 🐔`);
                    westernDuel = { step: 0, challenger: null, target: null, timer: null };
                }
            }, 30000);

            break;
        }

        // =================================================================
        // ==           AÑADE EL COMANDO REPETIDOR DE NUKE AQUÍ           ==
        // =================================================================

        case 'nuke': {
            if (!isMod) return; // Seguridad: Solo mods pueden usarlo

            // Unimos todos los argumentos (60 spam, o 60 120 spam)
            const nukeParams = args.join(' ');

            if (!nukeParams) {
                client.say(channel, "Uso: !nuke <segundos> [timeout] <frase>");
                return;
            }

            // El bot simplemente repite el comando exacto en el chat.
            // Al hacerlo con tu cuenta (redbreake), StreamElements lo ejecutará.
            client.say(channel, `!nuke ${nukeParams}`);
            break;
        }

        // =================================================================
        case 'title': {
            const newTitle = args.join(' ');

            // SI hay texto después del comando (función de MODERADOR)
            if (newTitle) {
                if (!isMod && !PERMA_WHITELIST_USERS.includes(username.toLowerCase())) return; // Permitir a la whitelist cambiar título
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
            if (!isMod && !PERMA_WHITELIST_USERS.includes(username.toLowerCase())) return;
            const newTitle = args.join(' ');
            if (!newTitle) {
                client.say(channel, "Uso: !settitulo <nuevo título del directo>");
                return;
            }

            try {
                await axios.patch(`https://api.twitch.tv/helix/channels?broadcaster_id=${CHANNEL_ID}`,
                    { title: newTitle },
                    {
                        headers: {
                            'Client-ID': config.TWITCH_CLIENT_ID,
                            'Authorization': `Bearer ${config.TWITCH_ACCESS_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                client.say(channel, `✅ ¡Título actualizado! Nuevo título: ${newTitle}`);
            } catch (error) {
                console.error("Error al cambiar el título:", error.response?.data || error.message);
                client.say(channel, "❌ Hubo un error al intentar cambiar el título. Revisa los permisos del token.");
            }
            break;
        }

        // =================================================================
        // ==      AÑADE ESTOS DOS NUEVOS COMANDOS DE EDICIÓN AQUÍ        ==
        // =================================================================

        case 'comando': {
            if (!isMod) return;

            const commandToCopy = args[0];
            const content = args.slice(1).join(' ');

            if (!commandToCopy || !content) {
                client.say(channel, `Uso: !comando <!nombre_del_comando> <contenido actual del comando>`);
                return;
            }

            commandEditorState = {
                isActive: true,
                commandName: commandToCopy,
                currentContent: content,
                editorUsername: username.toLowerCase()
            };

            client.say(channel, `✅ Ok, @${username}. Estoy listo para editar el comando ${commandToCopy}. Usa '+' seguido del texto que quieras añadir.`);
            break;
        }
        // =================================================================
        // ==            AÑADE EL NUEVO COMANDO ¡GUARDAR! AQUÍ            ==
        // =================================================================
        case 'guardar': {
            if (!isMod) return;

            // Comprobamos que haya una edición activa para guardar
            if (!commandEditorState.isActive) {
                client.say(channel, `No hay ninguna edición de comando activa para guardar. Usa !comando para empezar.`);
                return;
            }

            // Enviamos el comando de edición final con todo el contenido acumulado
            client.say(channel, `!cmd edit ${commandEditorState.commandName} ${commandEditorState.currentContent}`);

            // Avisamos y reseteamos el estado
            client.say(channel, `✅ ¡Comando ${commandEditorState.commandName} guardado!`);
            commandEditorState = { isActive: false, commandName: null, currentContent: null, editorUsername: null };
            break;
        }
        // =================================================================


        case 'cancelar': {
            if (!isMod) return;

            if (commandEditorState.isActive && username.toLowerCase() === commandEditorState.editorUsername) {
                commandEditorState = { isActive: false, commandName: null, currentContent: null, editorUsername: null };
                client.say(channel, `Edición del comando cancelada.`);
            } else {
                client.say(channel, `No hay ninguna edición activa para cancelar.`);
            }
            break;
        }

        // =================================================================
        // ==                 AÑADE EL COMANDO !piramide AQUÍ             ==
        // =================================================================

        case 'piramide': {
            if (!isMod) return; // ¡Solo para mods!

            let size = 3; // Tamaño por defecto si no se especifica
            let emote = args[0];

            // Comprobamos si el primer argumento es un número para el tamaño
            if (args.length > 1 && !isNaN(parseInt(args[0], 10))) {
                size = parseInt(args[0], 10);
                emote = args[1];
            }

            if (!emote) {
                client.say(channel, "Uso: !piramide [tamaño] <emote>");
                return;
            }

            // Limitamos el tamaño para no abusar y causar problemas
            if (size > 10 || size < 2) {
                client.say(channel, "El tamaño de la pirámide debe ser entre 2 y 5.");
                return;
            }

            buildPyramid(channel, emote, size);
            break;
        }

        // =================================================================

        // =================================================================
        // ==                 COMANDOS DE KARAOKE                         ==
        // =================================================================
        case 'cantar': {
            if (!isMod) return;
            const songName = args.join(' ');
            if (!songName) {
                client.say(channel, "Uso: !cantar <nombre_archivo_lrc>");
                return;
            }

            const success = karaoke.play(channel, songName);
            if (!success) {
                client.say(channel, `❌ No encontré el archivo de letra: lyrics/${songName}.lrc`);
            }
            break;
        }

        case 'stopcantar': {
            if (!isMod) return;
            if (karaoke.stop()) {
                client.say(channel, "🛑 Karaoke detenido.");
            } else {
                client.say(channel, "De por sí no estaba cantando nada.");
            }
            break;
        }

        // =================================================================
        // ==                   FIN DE LOS NUEVOS COMANDOS                ==
        // =================================================================

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
        case 'cupon':
            if (isAuthorized(username)) {
                const a = parseInt(args[0], 10);
                if (!isNaN(a) && a > 0) {
                    couponCount += a;
                    client.say(channel, `🎟️ ¡CUPONES AGREGADOS! Se han sumado ${a}. Ahora hay ${couponCount} cupones disponibles por ${COUPON_BIT_PRICE} piedritas cada uno.`);
                } else if (args[0] === '0') {
                    couponCount = 0;
                    client.say(channel, `🎟️ Cupones reseteados a 0.`);
                }
            }
            break;
        case 'playlist': if (config.PLAYLIST_ID) client.say(channel, `Playlist: https://www.youtube.com/playlist?list=${config.PLAYLIST_ID}`); break;
        case 'comandos': client.say(channel, `Stream: !hoy, !settitulo | Juegos: !adivina, !pokemon, !hoyoverse | Tops: !tops, !topspkm, !topshoyo | Música: !playlist | Otros: !reto, !muertes.`); break;
    }
}

/// =============================================================================
// ==                         INICIO DEL BOT Y CIERRE                         ==
// =============================================================================

async function startBot() {
    // 1. Autenticar con YouTube (No bloqueante)
    if (config.GOOGLE_CLIENT_ID) {
        getAccessToken().then(success => {
            if (success) {
                console.log("[v] Módulo de Playlist de YouTube cargado.");
            } else {
                console.warn("⚠️ Advertencia: El módulo de YouTube está listo pero sin tokens. Las canciones no se añadirán automáticamente.");
            }
        }).catch(err => {
            console.error("❌ Error inicializando YouTube:", err.message);
        });
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

// --- SERVIDOR KEEP-ALIVE (EXPRESS) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 Bot está en línea y funcionando. (Keep-alive activo)');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[v] Servidor de salud activo en puerto ${PORT}`);
});

// ¡Iniciamos el bot!
startBot();
