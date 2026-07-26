'use strict';

function parseLrc(content) {
    const timePattern = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;
    const lyrics = [];

    for (const line of content.split(/\r?\n/)) {
        const match = line.match(timePattern);
        if (!match) continue;

        const minutes = Number.parseInt(match[1], 10);
        const seconds = Number.parseInt(match[2], 10);
        const milliseconds = match[3]
            ? Number.parseInt(match[3].padEnd(3, '0').substring(0, 3), 10)
            : 0;
        const text = match[4].trim();

        if (text) {
            lyrics.push({
                time: (minutes * 60 * 1000) + (seconds * 1000) + milliseconds,
                text,
            });
        }
    }

    return lyrics.sort((a, b) => a.time - b.time);
}

module.exports = { parseLrc };
