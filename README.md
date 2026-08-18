# SUPERBOT

Bot multifunción para el canal de Twitch de Kala. Incluye moderación, playlist de
YouTube, comandos de stream, minijuegos, duelos, karaoke LRC, contadores y
respuestas con Gemini.

## Requisitos

- Node.js 22 LTS
- npm
- Credenciales de Twitch
- Credenciales de Google/YouTube si se usa la playlist

## Instalación local

```bash
npm ci
cp .env.example .env
npm start
```

Completa `.env` antes de iniciar. El bot valida las variables obligatorias y
termina con un mensaje claro si falta alguna.

En PowerShell, usa `Copy-Item .env.example .env` en lugar de `cp` si el alias no
está disponible.

## Variables de entorno

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `TWITCH_ACCESS_TOKEN` | Sí | Token OAuth usado por el bot |
| `TWITCH_CLIENT_ID` | Sí | Client ID de la aplicación de Twitch |
| `TWITCH_BOT_USERNAME` | Sí | Cuenta que se conecta al chat |
| `TWITCH_CHANNEL_NAME` | Sí | Canal de Kala |
| `AUTHORIZED_USERS` | No | Usuarios autorizados separados por comas |
| `GOOGLE_CLIENT_ID` | Para YouTube | Cliente OAuth de Google |
| `GOOGLE_CLIENT_SECRET` | Para YouTube | Secreto OAuth de Google |
| `GOOGLE_REDIRECT_URI` | Para YouTube | URI de redirección OAuth |
| `PLAYLIST_ID` | Para YouTube | Playlist que recibe las canciones |
| `YOUTUBE_TOKEN_JSON` | En Render | JSON completo del token de YouTube |
| `GEMINI_API_KEY` | No | Habilita el comando conectado con Gemini |
| `MIN_BITS_SONG` | No | Bits mínimos; valor predeterminado: `200` |
| `PORT` | No | Puerto HTTP; valor predeterminado: `3000` |

No publiques `.env`, `youtube_token.json` ni tokens en GitHub.

## Despliegue en Render

El repositorio incluye un `Procfile` para ejecutar el bot como worker:

```text
worker: node bot.js
```

Configuración recomendada:

- Runtime: Node
- Build command: `npm ci`
- Start command: `node bot.js`
- Health server: puerto indicado por `PORT`
- Variables secretas: configurarlas desde el panel de Render

El sistema de archivos de Render puede ser efímero. Por eso el token de YouTube
debe guardarse en `YOUTUBE_TOKEN_JSON`. Los contadores y puntuaciones escritos en
JSON pueden reiniciarse tras un nuevo despliegue si no se configura un disco
persistente.

## Verificación

```bash
npm run check
npm test
npm audit --omit=dev
```

`GET /` confirma que el proceso HTTP está vivo. `GET /status` muestra el estado
de Twitch, YouTube y el tiempo de actividad.

## Datos y letras

- `anime_list.json`, `pokemon.json` y `hoyoverse.json`: contenido de minijuegos.
- `*_scores.json` y `*_deaths.json`: estado mutable local.
- `lyrics/*.lrc`: letras sincronizadas utilizadas por `!cantar`.

Los archivos LRC deben usar marcas como `[00:12.50]Texto`.

## Moderación de enlaces

Cuando la automoderación está activa, los enlaces enviados por usuarios sin
privilegios se eliminan, salvo que tengan un `!permit` vigente. Los clips
oficiales con formato `clips.twitch.tv/...` o
`twitch.tv/<canal>/clip/...` están permitidos. Si el mismo mensaje contiene
además otro enlace, se modera normalmente.

## Comandos temporales

Los moderadores y el broadcaster pueden crear respuestas simples propias de
SUPERBOT:

```text
!crear !nombre Respuesta del comando
```

Después, cualquier usuario puede ejecutar `!nombre`. Repetir `!crear` con el
mismo nombre actualiza su respuesta. Estos comandos viven únicamente en memoria
y desaparecen cuando el proceso del bot se reinicia o vuelve a desplegarse.
Los comandos internos no se pueden sobrescribir.

## Mensajes fijados

Los moderadores y el broadcaster pueden gestionar el mensaje fijado del chat:

```text
!fijar <mensaje>
!quitarfijado
```

`!fijar` publica el texto desde la cuenta del bot y lo fija durante 20 minutos,
la duración establecida por Twitch para este tipo de envío. Si ya existe otro
mensaje fijado por moderación, Twitch lo reemplaza. `!quitarfijado` retira el
mensaje fijado actual, aunque lo haya fijado otro moderador.

## Seguridad operativa

- Cambia inmediatamente cualquier token que haya sido expuesto.
- Mantén actualizadas las dependencias y revisa `npm audit`.
- Prueba cambios en una rama antes de desplegar a `main`.
- Evita ejecutar simultáneamente dos instancias con la misma cuenta del bot.
