import makeWASocket, { DisconnectReason, useMultiFileAuthState, downloadMediaMessage, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import readline from 'readline';
import { writeFile, readFile, unlink } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import http from 'http';

// Servidor Web HTTP para evitar el "Timed Out" de Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot activo y funcionando 24/7');
}).listen(PORT, () => {
    console.log(`Servidor HTTP activo escuchando en el puerto ${PORT}`);
});

const execAsync = promisify(exec);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const BANNER_FILE = path.join(process.cwd(), 'banner.json');

async function getStoredBanner() {
    try {
        const data = await readFile(BANNER_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return { url: 'https://i.imgur.com/3ZQ6316.jpeg', type: 'image' };
    }
}

async function saveStoredBanner(url, type) {
    await writeFile(BANNER_FILE, JSON.stringify({ url, type }));
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    let phoneNumber = process.env.PHONE_NUMBER || "5493513157041";
    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

    if (!sock.authState.creds.registered) {
        console.log('\nSolicitando codigo de emparejamiento para:', phoneNumber);

        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`\n========================================`);
                console.log(`TU CODIGO DE EMPAREJAMIENTO ES: ${code}`);
                console.log(`========================================\n`);
            } catch (err) {
                console.error('Error al generar codigo:', err);
            }
        }, 4000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log('Sesion cerrada. Borra auth_info_baileys y vincula de nuevo.');
            } else {
                console.log('Reconectando bot...');
                startBot();
            }
        } else if (connection === 'open') {
            console.log('Bot conectado y listo para todos los usuarios.');
            try { rl.close(); } catch {}
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m || !m.message) return;

            const messageType = Object.keys(m.message)[0];
            let body = '';

            if (messageType === 'conversation') {
                body = m.message.conversation;
            } else if (messageType === 'extendedTextMessage') {
                body = m.message.extendedTextMessage.text;
            } else if (messageType === 'imageMessage' || messageType === 'videoMessage') {
                body = m.message[messageType].caption || '';
            }

            if (!body) return;
            const sender = m.key.remoteJid;
            const text = body.trim();

            const reply = async (texto) => {
                return await sock.sendMessage(sender, { text: texto }, { quoted: m });
            };

            const react = async (emoji = '🫰') => {
                return await sock.sendMessage(sender, {
                    react: { text: emoji, key: m.key }
                });
            };

            if (!text.startsWith('.') && !text.startsWith(',') && !text.startsWith('+')) return;

            const args = text.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const q = args.join(' ');

            // === COMANDO OWNER ===
            if (command === 'owner' || command === 'creador' || command === 'contacto') {
                await react('🫰');
                try {
                    const ownerNumber = "5493513157041";
                    const vcard = 'BEGIN:VCARD\r\n'
                        + 'VERSION:3.0\r\n' 
                        + 'N:Jonathan;Owner;;;\r\n'
                        + 'FN:Jonathan | Owner\r\n'
                        + 'ORG:Desarrollador Bot;\r\n'
                        + `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}\r\n`
                        + 'END:VCARD';

                    await sock.sendMessage(sender, { 
                        contacts: { 
                            displayName: 'Jonathan | Owner', 
                            contacts: [{ vcard }] 
                        } 
                    }, { quoted: m });
                } catch (err) {
                    console.error('Error en comando .owner:', err);
                    await reply('Error al enviar la tarjeta de contacto del Owner.');
                }
                return;
            }

            // === MENU ===
            if (command === 'menu' || command === 'help') {
                await react('🫰');
                const menuText = `*MENÚ DE COMANDOS*
*Prefijos permitidos:* \`.\` \`,\` \`+\`

*UTILIDADES Y SISTEMA*
• \`.ping\` ➔ *Latencia del servidor.*
• \`.owner\` ➔ *Contacto del Owner.*
• \`.ia\` ➔ *Preguntarle algo a la Inteligencia Artificial.*

*MULTIMEDIA Y STICKERS*
• \`.s\` ➔ *Crear sticker.*
• \`.toimg\` ➔ *Convertir sticker a imagen.*
• \`.revelar\` ➔ *Ver mensajes de una sola vez.*

*DESCARGAS CON API*
• \`.play\` ➔ *Descargar audio de YouTube.*
• \`.video\` ➔ *Descargar video de YouTube.*
• \`.tt\` ➔ *Descargar video de TikTok.*
• \`.ig\` ➔ *Descargar video/foto de Instagram.*`;

                const currentBanner = await getStoredBanner();
                try {
                    if (currentBanner.type === 'video') {
                        await sock.sendMessage(sender, { video: { url: currentBanner.url }, caption: menuText, gifPlayback: true }, { quoted: m });
                    } else {
                        await sock.sendMessage(sender, { image: { url: currentBanner.url }, caption: menuText }, { quoted: m });
                    }
                } catch {
                    await reply(menuText);
                }
                return;
            }

            // === PING ===
            if (command === 'ping') {
                await react('🫰');
                const start = Date.now();
                const sentMsg = await reply('Calculando ping...');
                const latencia = Date.now() - start;
                await sock.sendMessage(sender, { text: `Pong\nLatencia: *${latencia} ms*`, edit: sentMsg.key });
                return;
            }

            // === STICKER ===
            if (command === 's' || command === 'sticker') {
                await react('🫰');
                try {
                    const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    const targetMessage = quotedMsg ? { message: quotedMsg, key: { remoteJid: sender } } : m;
                    const mime = (targetMessage.message?.imageMessage || targetMessage.message?.videoMessage)?.mimetype || '';

                    if (!mime) return reply('Responde a una imagen o video corto con .s');

                    await reply('Procesando sticker...');
                    const buffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
                        logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage
                    });

                    const tempName = `img_${Date.now()}`;
                    const inputPath = path.join(process.cwd(), `${tempName}.tmp`);
                    const outputPath = path.join(process.cwd(), `${tempName}.webp`);

                    await writeFile(inputPath, buffer);
                    await execAsync(`ffmpeg -i "${inputPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -y "${outputPath}"`);

                    await sock.sendMessage(sender, { sticker: { url: outputPath } }, { quoted: m });
                    await unlink(inputPath).catch(() => {});
                    await unlink(outputPath).catch(() => {});
                } catch (err) {
                    console.error('Error en .s:', err);
                    await reply('Error al procesar el sticker.');
                }
                return;
            }

            // === DESCARGA YOUTUBE AUDIO (.play) ===
            if (command === 'play') {
                await react('🫰');
                if (!q) return reply('Escribe el nombre o link de YouTube.');
                try {
                    let videoUrl = q;
                    if (!q.startsWith('http://') && !q.startsWith('https://')) {
                        await reply('🔍 Buscando en YouTube...');
                        const searchRes = await fetch(`https://esdeath-api.onrender.com/api/youtube/search?q=${encodeURIComponent(q)}`);
                        const searchData = await searchRes.json();
                        videoUrl = searchData.url || searchData.results?.[0]?.url || searchData[0]?.url;
                        if (!videoUrl) return reply('❌ No se encontraron resultados.');
                    }

                    await reply('📥 Procesando audio...');
                    const apiRes = await fetch('https://esdeath-api.onrender.com/api/youtube', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: videoUrl, type: 'audio', upload: false })
                    });
                    const data = await apiRes.json();
                    const downloadUrl = data.downloadUrl || data.url || data.result;

                    if (!downloadUrl) return reply('❌ Error al obtener el audio desde la API.');

                    await sock.sendMessage(sender, { audio: { url: downloadUrl }, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
                } catch (err) {
                    await reply(`❌ Error: ${err.message}`);
                }
                return;
            }

            // === DESCARGA TIKTOK (.tt) ===
            if (command === 'tt' || command === 'tiktok') {
                await react('🫰');
                if (!q) return reply('Ingresa un enlace de TikTok.');
                try {
                    await reply('📥 Procesando video de TikTok...');
                    const apiRes = await fetch('https://esdeath-api.onrender.com/api/tiktok', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: q })
                    });
                    const data = await apiRes.json();
                    const downloadUrl = data.video || data.url || data.downloadUrl;

                    if (!downloadUrl) return reply('❌ No se pudo extraer el video de TikTok.');

                    await sock.sendMessage(sender, { video: { url: downloadUrl }, caption: 'Aquí tienes tu video de TikTok' }, { quoted: m });
                } catch (err) {
                    await reply(`❌ Error con TikTok: ${err.message}`);
                }
                return;
            }

            // === COMANDO IA (.ia) ===
            if (command === 'ia' || command === 'gemini') {
                await react('🫰');
                if (!q) return reply('Escribe tu pregunta para la Inteligencia Artificial.');
                try {
                    await reply('🧠 Pensando...');
                    const apiRes = await fetch(`https://esdeath-api.onrender.com/api/gemini?text=${encodeURIComponent(q)}`);
                    const data = await apiRes.json();
                    const responseText = data.response || data.text || data.result;

                    await reply(responseText || 'Sin respuesta de la IA.');
                } catch (err) {
                    await reply(`❌ Error en IA: ${err.message}`);
                }
                return;
            }

            // === REVELAR ===
            if (command === 'revelar' || command === 'read') {
                await react('🫰');
                try {
                    const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!quotedMsg) return reply('Responde a un mensaje de ver una sola vez con .revelar');

                    const viewOnceObj = quotedMsg.viewOnceMessage || quotedMsg.viewOnceMessageV2;
                    let actualMessage = viewOnceObj ? viewOnceObj.message : quotedMsg;

                    const targetKey = { message: actualMessage, key: { remoteJid: sender } };
                    await reply('Revelando contenido...');
                    const buffer = await downloadMediaMessage(targetKey, 'buffer', {}, {
                        logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage
                    });

                    if (actualMessage.imageMessage) {
                        await sock.sendMessage(sender, { image: buffer, caption: 'Contenido revelado' }, { quoted: m });
                    } else if (actualMessage.videoMessage) {
                        await sock.sendMessage(sender, { video: buffer, caption: 'Contenido revelado' }, { quoted: m });
                    }
                } catch (err) {
                    console.error('Error en .revelar:', err);
                }
                return;
            }

        } catch (error) {
            console.error('Error general procesando mensaje:', error);
        }
    });
}

startBot();
