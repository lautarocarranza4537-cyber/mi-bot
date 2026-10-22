import makeWASocket, { DisconnectReason, useMultiFileAuthState, downloadMediaMessage, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import readline from 'readline';
import { writeFile, readFile, unlink } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askQuestion = (text) => new Promise((resolve) => rl.question(text, resolve));

const BANNER_FILE = path.join(process.cwd(), 'banner.json');
const API_BASE = 'https://esdeath-api.onrender.com';

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
            console.log('Bot conectado y listo.');
            try { rl.close(); } catch {}
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message) return;

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

            // === COMANDO OWNER / CREADOR ===
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

            // === MENU MULTIMEDIA ===
            if (command === 'menu' || command === 'help') {
                await react('🫰');
                const menuText = `*MENÚ DE COMANDOS*
*Prefijos permitidos:* \`.\` \`,\` \`+\`

*UTILIDADES Y SISTEMA*
• \`.ping\` ➔ *Muestra la latencia en tiempo real.*
• \`.owner\` ➔ *Muestra la tarjeta de contacto de Jonathan | Owner.*
• \`.setbanner\` ➔ *Guarda foto, GIF o video citado como banner principal.*

*MULTIMEDIA Y STICKERS*
• \`.s\` o \`.sticker\` ➔ *Convierte foto o video corto en sticker.*
• \`.toimg\` ➔ *Convierte un sticker en formato de imagen.*
• \`.revelar\` ➔ *Muestra el contenido de fotos o videos de una sola vez.*

*DESCARGAS Y STREAMING (VÍA API)*
• \`.play\` ➔ *Busca y descarga música.*
• \`.play2\` ➔ *Descarga video de YouTube.*
• \`.video\` ➔ *Descarga videos universales.*
• \`.tt\` ➔ *Descarga videos de TikTok.*
• \`.ig\` ➔ *Descarga contenido de Instagram.*
• \`.fb\` ➔ *Descarga videos de Facebook.*`;

                const currentBanner = await getStoredBanner();
                try {
                    if (currentBanner.type === 'video') {
                        await sock.sendMessage(sender, {
                            video: { url: currentBanner.url },
                            caption: menuText,
                            gifPlayback: true
                        }, { quoted: m });
                    } else {
                        await sock.sendMessage(sender, {
                            image: { url: currentBanner.url },
                            caption: menuText
                        }, { quoted: m });
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

            // === SETBANNER ===
            if (command === 'setbanner') {
                await react('🫰');
                try {
                    const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    const targetMessage = quotedMsg ? { message: quotedMsg, key: { remoteJid: sender } } : m;
                    const isImage = targetMessage.message?.imageMessage;
                    const isVideo = targetMessage.message?.videoMessage;

                    if (!isImage && !isVideo) {
                        return reply('Responde a una imagen, GIF o video corto con .setbanner.');
                    }

                    const mime = (isImage || isVideo).mimetype || '';
                    const buffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
                        logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage
                    });

                    const ext = mime.includes('video') ? 'mp4' : 'jpg';
                    const type = mime.includes('video') ? 'video' : 'image';
                    const bannerPath = path.join(process.cwd(), `banner_${Date.now()}.${ext}`);

                    await writeFile(bannerPath, buffer);
                    await saveStoredBanner(bannerPath, type);

                    await reply(`Banner actualizado correctamente (${type === 'video' ? 'Video/GIF' : 'Imagen'}).`);
                } catch (err) {
                    console.error('Error en setbanner:', err);
                    await reply('Error al actualizar el banner.');
                }
                return;
            }

            // === STICKER (.s) ===
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

            // === TOIMG ===
            if (command === 'toimg') {
                await react('🫰');
                try {
                    const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!quotedMsg || !quotedMsg.stickerMessage) {
                        return reply('Responde a un sticker con .toimg para pasarlo a imagen.');
                    }

                    await reply('Convirtiendo sticker a imagen...');
                    const targetMessage = { message: quotedMsg, key: { remoteJid: sender } };
                    const buffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
                        logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage
                    });

                    const tempPath = path.join(process.cwd(), `img_${Date.now()}.png`);
                    await writeFile(tempPath, buffer);

                    await sock.sendMessage(sender, { image: { url: tempPath }, caption: 'Aqui tienes tu imagen' }, { quoted: m });
                    await unlink(tempPath).catch(() => {});
                } catch (err) {
                    console.error('Error en .toimg:', err);
                    await reply('Error al convertir el sticker a imagen.');
                }
                return;
            }

            // === PLAY (MÚSICA CON API) ===
            if (command === 'play') {
                await react('🫰');
                if (!q) return reply('Escribe el nombre o link de la cancion.');
                try {
                    await reply('Procesando solicitud mediante API...');
                    const res = await fetch(`${API_BASE}/api/play?text=${encodeURIComponent(q)}`);
                    const data = await res.json();

                    const audioUrl = data.url || data.result?.url || data.download || data.result;
                    if (!audioUrl) return reply('La API no devolvio un enlace de audio valido.');

                    await sock.sendMessage(sender, { 
                        audio: { url: audioUrl }, 
                        mimetype: 'audio/mp4', 
                        ptt: false 
                    }, { quoted: m });
                } catch (err) {
                    console.error('Error en .play con API:', err);
                    await reply('Error al conectar con la API de descargas.');
                }
                return;
            }

            // === PLAY2 / VIDEO (VIDEO CON API) ===
            if (command === 'play2' || command === 'video') {
                await react('🫰');
                if (!q) return reply('Ingresa el nombre o enlace del video.');
                try {
                    await reply('Descargando video mediante API...');
                    const res = await fetch(`${API_BASE}/api/ytmp4?url=${encodeURIComponent(q)}`);
                    const data = await res.json();

                    const videoUrl = data.url || data.result?.url || data.download || data.result;
                    if (!videoUrl) return reply('La API no devolvio un enlace de video valido.');

                    await sock.sendMessage(sender, { 
                        video: { url: videoUrl }, 
                        caption: 'Video descargado con exito.' 
                    }, { quoted: m });
                } catch (err) {
                    console.error('Error en video con API:', err);
                    await reply('Error al procesar el video desde la API.');
                }
                return;
            }

            // === TIKTOK (.tt CON API) ===
            if (command === 'tt') {
                await react('🫰');
                if (!q || !q.startsWith('http')) return reply('Ingresa un enlace valido de TikTok.');
                try {
                    await reply('Descargando de TikTok via API...');
                    const res = await fetch(`${API_BASE}/api/tiktok?url=${encodeURIComponent(q)}`);
                    const data = await res.json();

                    const videoUrl = data.url || data.result?.url || data.download || data.result;
                    if (!videoUrl) return reply('No se pudo obtener el video de TikTok.');

                    await sock.sendMessage(sender, { video: { url: videoUrl }, caption: 'TikTok descargado' }, { quoted: m });
                } catch (err) {
                    console.error('Error en .tt con API:', err);
                    await reply('Error al consultar TikTok en la API.');
                }
                return;
            }

            // === INSTAGRAM (.ig CON API) ===
            if (command === 'ig') {
                await react('🫰');
                if (!q || !q.startsWith('http')) return reply('Ingresa el enlace de Instagram.');
                try {
                    await reply('Descargando de Instagram via API...');
                    const res = await fetch(`${API_BASE}/api/ig?url=${encodeURIComponent(q)}`);
                    const data = await res.json();

                    const videoUrl = data.url || data.result?.url || data.download || data.result;
                    if (!videoUrl) return reply('No se pudo obtener el contenido de Instagram.');

                    await sock.sendMessage(sender, { video: { url: videoUrl }, caption: 'Instagram descargado' }, { quoted: m });
                } catch (err) {
                    console.error('Error en .ig con API:', err);
                    await reply('Error al consultar Instagram en la API.');
                }
                return;
            }

            // === FACEBOOK (.fb CON API) ===
            if (command === 'fb') {
                await react('🫰');
                if (!q || !q.startsWith('http')) return reply('Ingresa el enlace de Facebook.');
                try {
                    await reply('Descargando de Facebook via API...');
                    const res = await fetch(`${API_BASE}/api/fb?url=${encodeURIComponent(q)}`);
                    const data = await res.json();

                    const videoUrl = data.url || data.result?.url || data.download || data.result;
                    if (!videoUrl) return reply('No se pudo obtener el video de Facebook.');

                    await sock.sendMessage(sender, { video: { url: videoUrl }, caption: 'Facebook descargado' }, { quoted: m });
                } catch (err) {
                    console.error('Error en .fb con API:', err);
                    await reply('Error al consultar Facebook en la API.');
                }
                return;
            }

            // === REVELAR ===
            if (command === 'revelar' || command === 'read') {
                await react('🫰');
                try {
                    const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!quotedMsg) return reply('Responde a un mensaje de ver una sola vez con .revelar');

                    const viewOnceObj = quotedMsg.viewOnceMessage ||
                                        quotedMsg.viewOnceMessageV2 ||
                                        quotedMsg.viewOnceMessageV2Extension ||
                                        quotedMsg.ephemeralMessage?.message?.viewOnceMessage ||
                                        quotedMsg.ephemeralMessage?.message?.viewOnceMessageV2;

                    let actualMessage = viewOnceObj ? viewOnceObj.message : quotedMsg;

                    if (!actualMessage?.imageMessage && !actualMessage?.videoMessage) {
                        if (quotedMsg.imageMessage || quotedMsg.videoMessage) {
                            actualMessage = quotedMsg;
                        } else {
                            return reply('El mensaje al que respondiste no contiene contenido multimedia.');
                        }
                    }

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
