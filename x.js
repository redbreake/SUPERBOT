// =============================================================================
// ==                  SCRIPT DE SCRAPEO DE QUOTES (JS) - v1.2                ==
// ==          (Con capacidad de parar y continuar desde un número)          ==
// =============================================================================

// --- DEPENDENCIAS (Usa las que ya tienes instaladas para el superbot) ---
require('dotenv').config();
const tmi = require('tmi.js');
const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN (¡AJUSTA ESTO!) ---
// -----------------------------------------------------------------------------
// El nombre del bot que gestiona las quotes (muy importante, en minúsculas).
const QUOTE_BOT_NAME = "streamelements"; 

// El mensaje de error que indica que ya no hay más quotes.
const ERROR_MESSAGE = "does not exist";

// El nombre del archivo donde se guardarán las quotes.
const OUTPUT_FILE = "quotes.json";
// -----------------------------------------------------------------------------


// --- LÓGICA DEL BOT DE SCRAPEO ---

console.log("--- Iniciando el scraper de quotes ---");

// --> NUEVO: Permite especificar un número de inicio desde la terminal
let startQuoteNumber = 1;
const startArg = process.argv[2]; // El primer argumento después de 'node script.js'

if (startArg) {
    const parsedNumber = parseInt(startArg, 10);
    if (!isNaN(parsedNumber) && parsedNumber > 0) {
        startQuoteNumber = parsedNumber;
        console.log(`[INFO] Se especificó un número de inicio. Empezando desde la quote #${startQuoteNumber}.`);
    } else {
        console.log(`[AVISO] El argumento '${startArg}' no es un número válido. Empezando desde la quote #1.`);
    }
} else {
    console.log("[INFO] No se especificó un número de inicio. Empezando desde la quote #1.");
}

const config = {
    TWITCH_ACCESS_TOKEN: process.env.TWITCH_ACCESS_TOKEN,
    BOT_USERNAME: process.env.TWITCH_BOT_USERNAME,
    CHANNEL_NAME: process.env.TWITCH_CHANNEL_NAME,
};

if (!config.TWITCH_ACCESS_TOKEN || !config.BOT_USERNAME || !config.CHANNEL_NAME) {
    console.error("❌ Error fatal: No se encontraron las variables de entorno necesarias.");
    process.exit(1);
}

const client = new tmi.Client({
    options: { debug: false },
    connection: {
        reconnect: true,
        secure: true,
        capabilities: { 'twitch.tv/tags': true, 'twitch.tv/commands': true }
    },
    identity: {
        username: config.BOT_USERNAME,
        password: `oauth:${config.TWITCH_ACCESS_TOKEN}`
    },
    channels: [config.CHANNEL_NAME]
});

// Ahora, la variable que lleva la cuenta empieza desde el número que especificamos
let currentQuoteNumber = startQuoteNumber;
const quotesData = [];
let isScraping = false;
let timeoutId = null;

const finishScraping = () => {
    isScraping = false;
    clearTimeout(timeoutId);

    console.log("\n--- Proceso finalizado ---");
    
    // Si no hemos recopilado ninguna quote nueva, no sobreescribimos el archivo
    if (quotesData.length === 0) {
        console.log("No se han recopilado quotes nuevas en esta sesión. El archivo no ha sido modificado.");
    } else {
        // Leemos el archivo existente (si lo hay) para añadir las nuevas quotes
        let existingQuotes = [];
        if (fs.existsSync(OUTPUT_FILE)) {
            try {
                existingQuotes = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
            } catch (e) {
                console.warn("AVISO: El archivo quotes.json existente parece estar corrupto. Se va a sobreescribir.");
            }
        }

        // Combinamos las quotes viejas y las nuevas
        const allQuotes = [...existingQuotes, ...quotesData];

        // Eliminamos duplicados por si acaso, quedándonos con la última versión
        const uniqueQuotes = Array.from(new Map(allQuotes.map(q => [q.id, q])).values());
        // Ordenamos por ID
        uniqueQuotes.sort((a, b) => a.id - b.id);

        try {
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(uniqueQuotes, null, 2), 'utf8');
            console.log(`✅ ¡Éxito! El archivo '${OUTPUT_FILE}' ha sido actualizado. Contiene un total de ${uniqueQuotes.length} quotes.`);
        } catch (error) {
            console.error("❌ Error al guardar el archivo JSON:", error);
        }
    }
    
    console.log("Cerrando la conexión...");
    client.disconnect();
    setTimeout(() => process.exit(0), 1000);
};

const requestNextQuote = () => {
    client.say(config.CHANNEL_NAME, `!quote ${currentQuoteNumber}`);
    console.log(`-> Solicitando !quote ${currentQuoteNumber}`);
    
    timeoutId = setTimeout(() => {
        console.log("<- No se recibió respuesta en 5 segundos. Finalizando por timeout.");
        finishScraping();
    }, 5000);
};

client.on('connected', (addr, port) => {
    console.log(`¡Conectado como ${config.BOT_USERNAME} al canal #${config.CHANNEL_NAME}!`);
    console.log("Iniciando el proceso en 3 segundos...");
    
    setTimeout(() => {
        isScraping = true;
        requestNextQuote();
    }, 3000);
});

client.on('message', (channel, tags, message, self) => {
    if (self || !isScraping || tags.username.toLowerCase() !== QUOTE_BOT_NAME) {
        return;
    }
    
    clearTimeout(timeoutId);
    
    if (message.toLowerCase().includes(ERROR_MESSAGE)) {
        console.log("<- Respuesta de error recibida. Se asume que no hay más quotes.");
        finishScraping();
        return;
    }

    try {
        const firstColonIndex = message.indexOf(':');
        if (firstColonIndex === -1) {
            throw new Error("Formato de quote no reconocido (falta ':').");
        }
        const quoteText = message.substring(firstColonIndex + 1).trim();
        
        console.log(`<- Quote #${currentQuoteNumber} guardada: ${quoteText.substring(0, 50)}...`);
        quotesData.push({
            id: currentQuoteNumber,
            text: quoteText
        });
        
        currentQuoteNumber++;
        setTimeout(requestNextQuote, 1500);

    } catch (error) {
        console.log(`AVISO: No se pudo procesar el mensaje del bot: "${message}" (${error.message})`);
        currentQuoteNumber++;
        setTimeout(requestNextQuote, 1500);
    }
});

client.connect().catch(console.error);

process.on('SIGINT', () => {
    if (isScraping) {
        console.log("\n🛑 Proceso interrumpido. Guardando quotes obtenidas hasta ahora...");
        finishScraping();
    }
});