const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('¡El bot de WhatsApp está activo!');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
        },
        browser: [ "Ubuntu", "Chrome", "20.0.04" ]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log('¡Conectado exitosamente a WhatsApp!');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        }
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = "5493516609573";
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(`TU CÓDIGO DE EMPAREJAMIENTO ES: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("Error al solicitar código, reintentando...", error);
            }
        }, 7000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            if (mek.key.fromMe) return;
            if (chatUpdate.type !== 'notify') return;

            const messageType = Object.keys(mek.message)[0];
            const body = messageType === 'conversation' ? mek.message.conversation :
                         messageType === 'extendedTextMessage' ? mek.message.extendedTextMessage.text : '';
            
            const from = mek.key.remoteJid;
            
            if (body && body.trim() === ',ping') {
                const start = Date.now();
                const sentMsg = await sock.sendMessage(from, { text: 'Pong! 🏓' }, { quoted: mek });
                const latency = Date.now() - start;
                
                await sock.sendMessage(from, { 
                    text: `Velocidad de respuesta: *${latency}ms*`, 
                    edit: sentMsg.key 
                });
            }
        } catch (err) {
            console.error("Error procesando mensaje:", err);
        }
    });
}

startBot();
