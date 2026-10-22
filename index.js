import makeWASocket, { DisconnectReason, useMultiFileAuthState, downloadMediaMessage, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import readline from 'readline';
import { writeFile, readFile, unlink } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import http from 'http';

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

            // === COMANDO SETBANNER ===
            if (command === 'setbanner') {
                await react('🫰');
                try {
                    const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    let bannerUrl = q;
                    let bannerType = 'image';

                    if (quotedMsg) {
                        const mime = (quotedMsg.imageMessage || quotedMsg.videoMessage)?.mimetype || '';
                        if (mime.includes('image')) bannerType = 'image';
                        else if (mime.includes('video')) bannerType = 'video';
                        else return reply('El mensaje respondido no es una imagen o video.');

                        const targetMessage = { message: quotedMsg, key: { remoteJid: sender } };
                        const buffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
                            logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage
                        });

                        const ext = bannerType === 'video' ? 'mp4' : 'jpg';
                        const tempFile = path.join(process.cwd(), `banner_temp.${ext}`);
                        await writeFile(tempFile, buffer);
                        
                        bannerUrl = tempFile; 
                    } else if (!q.startsWith('http')) {
                        return reply('Responde a una imagen/video o coloca un enlace directo.');
                    }

                    await saveStoredBanner(bannerUrl, bannerType);
                    await reply('✅ ¡Banner actualizado correctamente para el menú!');
                } catch (err) {
                    await reply(`❌ Error al guardar banner: ${err.message}`);
                }
                return;
            }

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
                    await reply('Error al enviar la tarjeta de contacto.');
                }
                return;
            }

            // === MENU ===
            if (command === 'menu' || command === 'help') {
                await react('🫰');
                const menuText = `*MENÚ DE COMANDOS COMPLETO*
*Prefijos permitidos:* \`.\` \`,\` \`+\`

*UTILIDADES Y SISTEMA*
• \`.ping\` ➔ *Latencia del servidor.*
• \`.owner\` ➔ *Contacto del Creador.*
• \`.setbanner\` ➔ *Cambiar banner del menú.*

*INTELIGENCIA ARTIFICIAL*
• \`.ia\` / \`.gemini\` ➔ *Consultar a Gemini.*
• \`.qwen\` ➔ *Consultar a Qwen IA.*
• \`.deepseek\` ➔ *Consultar a DeepSeek.*
• \`.dphn\` ➔ *Consultar a DPHN.*

*MULTIMEDIA Y STICKERS*
• \`.s\` ➔ *Crear sticker.*
• \`.toimg\` ➔ *Convertir sticker a imagen.*
• \`.revelar\` ➔ *Ver fotos/videos de una sola vez.*

*DESCARGAS CON API*
• \`.play\` ➔ *Audio de YouTube + Información.*
• \`.video\` ➔ *Video de YouTube + Información.*
• \`.tt\` ➔ *Video de TikTok.*
• \`.ig\` ➔ *Instagram.*
• \`.fb\` ➔ *Facebook.*
• \`.spotify\` ➔ *Música de Spotify.*
• \`.pinterest\` ➔ *Buscador Pinterest.*`;

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

            // === STICKERS ===
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
                    await reply('Error al procesar el sticker.');
                }
                return;
            }

            // === DESCARGAS YOUTUBE AUDIO/VIDEO CON TARJETA DE INFORMACIÓN ===
            if (command === 'play' || command === 'video') {
                await react('🫰');
                if (!q) return reply('Escribe el nombre o link de YouTube.');
                try {
                    let targetUrl = q;
                    let searchInfo = null;

                    await reply('🔍 Buscando e identificando contenido...');

                    // Búsqueda en la API si no es una URL directa
                    if (!q.startsWith('http://') && !q.startsWith('https://')) {
                        const searchRes = await fetch(`https://esdeath-api.onrender.com/api/youtube/search?q=${encodeURIComponent(q)}`);
                        const searchData = await searchRes.json();
                        
                        const item = Array.isArray(searchData) ? searchData[0] : (searchData.results?.[0] || searchData);
                        if (!item || (!item.url && !item.link)) return reply('❌ No se encontraron resultados para la búsqueda.');

                        targetUrl = item.url || item.link;
                        searchInfo = item;
                    }

                    const typeMedia = command === 'play' ? 'audio' : 'video';

                    // Petición de descarga a la API
                    const apiRes = await fetch('https://esdeath-api.onrender.com/api/youtube', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: targetUrl, type: typeMedia, upload: false })
                    });
                    const data = await apiRes.json();
                    
                    const downloadUrl = data.downloadUrl || data.url || data.result?.url || data.result;
                    if (!downloadUrl) return reply('❌ No se pudo extraer la URL de descarga.');

                    // Extraer metadatos para la tarjeta informativa
                    const title = data.title || searchInfo?.title || 'Canción/Video de YouTube';
                    const author = data.author || data.channel || searchInfo?.author?.name || searchInfo?.channel || 'YouTube Content';
                    const duration = data.duration || searchInfo?.duration || searchInfo?.timestamp || 'N/A';
                    const views = data.views || searchInfo?.views || 'N/A';
                    const likes = data.likes || searchInfo?.likes || 'N/A';
                    const thumbnail = data.thumbnail || data.thumb || searchInfo?.thumbnail || searchInfo?.image || 'https://i.imgur.com/3ZQ6316.jpeg';

                    const infoCaption = `🎵 *INFORMACIÓN DE LA CANCIÓN*
📌 *Título:* ${title}
👤 *Canal/Creador:* ${author}
⏱️ *Duración:* ${duration}
👁️ *Vistas:* ${views}
👍 *Likes:* ${likes}
🔗 *Link:* ${targetUrl}`;

                    // 1. Enviar la Tarjeta con la foto e información
                    try {
                        await sock.sendMessage(sender, { image: { url: thumbnail }, caption: infoCaption }, { quoted: m });
                    } catch {
                        await reply(infoCaption);
                    }

                    // 2. Enviar el Audio/Video justo abajo
                    if (typeMedia === 'audio') {
                        await sock.sendMessage(sender, { audio: { url: downloadUrl }, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
                    } else {
                        await sock.sendMessage(sender, { video: { url: downloadUrl }, caption: `*${title}*` }, { quoted: m });
                    }
                } catch (err) {
                    await reply(`❌ Error procesando solicitud: ${err.message}`);
                }
                return;
            }

            // === TIKTOK (.tt) ===
            if (command === 'tt' || command === 'tiktok') {
                await react('🫰');
                if (!q) return reply('Ingresa un enlace de TikTok.');
                try {
                    await reply('📥 Procesando TikTok...');
                    const apiRes = await fetch('https://esdeath-api.onrender.com/api/tiktok', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: q, type: 'video', upload: false })
                    });
                    const data = await apiRes.json();
                    const downloadUrl = data.video || data.downloadUrl || data.url || data.result?.url || data.result;

                    if (!downloadUrl) return reply('❌ Error al obtener el video de TikTok.');
                    await sock.sendMessage(sender, { video: { url: downloadUrl }, caption: 'Aquí tienes tu video de TikTok' }, { quoted: m });
                } catch (err) {
                    await reply(`❌ Error: ${err.message}`);
                }
                return;
            }

            // === INSTAGRAM (.ig) ===
            if (command === 'ig' || command === 'instagram') {
                await react('🫰');
                if (!q) return reply('Ingresa un enlace de Instagram.');
                try {
                    await reply('📥 Procesando Instagram...');
                    const apiRes = await fetch('https://esdeath-api.onrender.com/api/instagram', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: q, upload: false })
                    });
                    const data = await apiRes.json();
                    const downloadUrl = data.url || data.downloadUrl || data.result?.url || data.result?.[0] || data.result;

                    if (!downloadUrl) return reply('❌ Error al extraer contenido de Instagram.');
                    await sock.sendMessage(sender, { video: { url: downloadUrl }, caption: 'Aquí tienes tu contenido de Instagram' }, { quoted: m });
                } catch (err) {
                    await reply(`❌ Error: ${err.message}`);
                }
                return;
            }

            // === FACEBOOK (.fb) ===
            if (command === 'fb' || command === 'facebook') {
                await react('🫰');
                if (!q) return reply('Ingresa un enlace de Facebook.');
                try {
                    await reply('📥 Procesando Facebook...');
                    const apiRes = await fetch('https://esdeath-api.onrender.com/api/facebook', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: q, upload: false })
                    });
                    const data = await apiRes.json();
                    const downloadUrl = data.url || data.downloadUrl || data.result?.url || data.result;

                    if (!downloadUrl) return reply('❌ Error al obtener el video de Facebook.');
                    await sock.sendMessage(sender, { video: { url: downloadUrl }, caption: 'Aquí tienes tu video de Facebook' }, { quoted: m });
                } catch (err) {
                    await reply(`❌ Error: ${err.message}`);
                }
                return;
            }

            // === SPOTIFY (.spotify) ===
            if (command === 'spotify') {
                await react('🫰');
                if (!q) return reply('Ingresa un enlace de Spotify.');
                try {
                    await reply('📥 Procesando Spotify...');
                    const apiRes = await fetch('https://esdeath-api.onrender.com/api/spotify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: q, upload: false })
                    });
                    const data = await apiRes.json();
                    const downloadUrl = data.url || data.downloadUrl || data.result?.url || data.result;

                    if (!downloadUrl) return reply('❌ Error al obtener audio de Spotify.');
                    await sock.sendMessage(sender, { audio: { url: downloadUrl }, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
                } catch (err) {
                    await reply(`❌ Error: ${err.message}`);
                }
                return;
            }

            // === PINTEREST (.pinterest / .pin) ===
            if (command === 'pinterest' || command === 'pin') {
                await react('🫰');
                if (!q) return reply('Escribe lo que quieres buscar en Pinterest.');
                try {
                    await reply('🔍 Buscando en Pinterest...');
                    const apiRes = await fetch(`https://esdeath-api.onrender.com/api/pinterest?q=${encodeURIComponent(q)}`);
                    const data = await apiRes.json();
                    const imageUrl = data.url || data.results?.[0] || data[0];

                    if (!imageUrl) return reply('❌ No se encontraron imágenes.');
                    await sock.sendMessage(sender, { image: { url: imageUrl }, caption: `Resultado para: *${q}*` }, { quoted: m });
                } catch (err) {
                    await reply(`❌ Error: ${err.message}`);
                }
                return;
            }

            // === IA (GEMINI, QWEN, DEEPSEEK, DPHN) ===
            if (['ia', 'gemini', 'qwen', 'deepseek', 'dphn'].includes(command)) {
                await react('🫰');
                if (!q) return reply('Escribe tu pregunta para la IA.');
                try {
                    await reply('🧠 Pensando...');
                    let endpoint = command === 'ia' ? 'gemini' : command;
                    let bodyPayload = { prompt: q };

                    if (endpoint === 'gemini') {
                        bodyPayload = { prompt: q, chatId: null, model: 'flash-lite' };
                    } else if (endpoint === 'dphn') {
                        bodyPayload = { prompt: q, template: 'logical' };
                    } else if (endpoint === 'deepseek') {
                        bodyPayload = { prompt: q, chatId: null, parentId: null };
                    }

                    const apiRes = await fetch(`https://esdeath-api.onrender.com/api/${endpoint}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(bodyPayload)
                    });
                    const data = await apiRes.json();
                    const answer = data.response || data.text || data.result;

                    await reply(answer || 'Sin respuesta de la IA.');
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
                    if (!quotedMsg) return reply('Responde a un mensaje de ver una sola vez.');

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
