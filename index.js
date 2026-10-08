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
        browser: Browsers.macOS('Chrome')
    });

    sock.ev.on('creds.update', saveCreds);

    let pairingRequested = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('\n[CONEXIÓN] ¡Bot conectado exitosamente en la nube y listo para responder ,ping!\n');
        }

        if (!sock.authState.creds.registered && !pairingRequested && (connection === 'connecting' || connection === undefined)) {
            setTimeout(async () => {
                if (pairingRequested) return;
                pairingRequested = true;
                try {
                    const phoneNumber = '5493516609573';
                    console.log(`\n[PAIRING] Solicitando código de 8 dígitos para: ${phoneNumber}...`);
                    const code = await sock.requestPairingCode(phoneNumber);
                    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log(`\n==================================================`);
                    console.log(`>>> CÓDIGO DE VINCULACIÓN: ${formattedCode} <<<`);
                    console.log(`==================================================\n`);
                } catch (err) {
                    console.error('[PAIRING ERROR] No se pudo solicitar el código:', err.message);
                    pairingRequested = false;
                }
            }, 3000);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[CONEXIÓN] Cerrada (Código: ${statusCode}). Reconectando: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(() => startBot(), 3000);
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
