import pino from 'pino';
import pkg from '@whiskeysockets/baileys';
import express from 'express';

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('¡El bot de WhatsApp está activo en Render! 🚀');
});

app.listen(PORT, () => {
    console.log(`[WEB] Servidor HTTP escuchando en el puerto ${PORT}`);
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('\n[CONEXIÓN] ¡Bot conectado exitosamente en Render con la sesión guardada!\n');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[CONEXIÓN] Cerrada (Código: ${statusCode}). Reconectando: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(() => startBot(), 4000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const remoteJid = msg.key.remoteJid;

        if (text === ',ping') {
            await sock.sendMessage(remoteJid, { text: '¡Pong! 🏓' }, { quoted: msg });
        }
    });
}

startBot();
