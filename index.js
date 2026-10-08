const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const express = require('express');

// Servidor Express básico para Render (evita que el servicio se duerma por inactividad)
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

    // Solicitar código de emparejamiento si no está conectado
    if (!sock.authState.creds.registered) {
        const phoneNumber = "5493516609573";
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(`TU CÓDIGO DE EMPAREJAMIENTO ES: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("Error al solicitar el código de emparejamiento:", error);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('¡Conectado exitosamente a WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Manejador de mensajes para el comando ,ping
    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const mek = messages[0];
            if (!mek.message) return;
            
            const messageType = Object.keys(mek.message)[0];
            const body = messageType === 'conversation' ? mek.message.conversation :
                         messageType === 'extendedTextMessage' ? mek.message.extendedTextMessage.text : '';
            
            const from = mek.key.remoteJid;
            
            // Comando ,ping (responde a cualquier usuario y al número vinculado)
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

