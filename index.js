import makeWASocket, { DisconnectReason, useMultiFileAuthState, downloadMediaMessage, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import readline from 'readline';
import { writeFile, readFile, unlink, stat } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askQuestion = (text) => new Promise((resolve) => rl.question(text, resolve));

const BANNER_FILE = path.join(process.cwd(), 'banner.json');
const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // Límite de 20MB para audios

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

function formatDuration(seconds) {
    if (!seconds) return 'Desconocida';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
        return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
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
        if (!phoneNumber) {
            console.log('\nCONFIGURACION DE EMPAREJAMIENTO');
            phoneNumber = await askQuestion('Ingresa tu numero de WhatsApp (ej: 549351XXXXXXXX): ');
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        }

        try { rl.close(); } catch {}
        console.log('Conectando y solicitando codigo de emparejamiento para:', phoneNumber);

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
        }, 3000);
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

            // Validacion de comandos tradicionales (. o , o +)
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

*DESCARGAS Y STREAMING*
• \`.play\` ➔ *Busca y descarga música de YouTube (máx. 20MB).*
• \`.play2\` ➔ *Descarga video o Short de YouTube en calidad 720p.*
• \`.video\` ➔ *Descarga videos de cualquier aplicación o página web.*
• \`.sc\` ➔ *Busca y descarga audios desde SoundCloud (máx. 20MB).*
• \`.tt\` ➔ *Descarga videos de TikTok por enlace directo.*
• \`.ig\` ➔ *Descarga contenido multimedia de Instagram.*
• \`.fb\` ➔ *Descarga videos desde Facebook.*`;

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
                        return reply('Responde a una imagen, GIF o video corto con .setbanner para establecerlo como banner.');
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

            // === PLAY (MÚSICA CON LÍMITE STRICTO DE 20MB) ===
            if (command === 'play') {
                await react('🫰');
                if (!q) return reply('Escribe el nombre o link de la cancion.\nEjemplo: .play Bad Bunny');
                try {
                    await reply('Buscando informacion y archivo de audio...');

                    const querySearch = q.startsWith('http') ? q : `ytsearch1:${q}`;
                    const jsonCmd = `yt-dlp -j --skip-download "${querySearch}"`;
                    const { stdout } = await execAsync(jsonCmd);
                    const info = JSON.parse(stdout.trim().split('\n')[0]);

                    const title = info.title || 'Desconocido';
                    const channel = info.uploader || info.channel || 'Desconocido';
                    const duration = formatDuration(info.duration);
                    const views = info.view_count ? info.view_count.toLocaleString() : 'No disponible';
                    const likes = info.like_count ? info.like_count.toLocaleString() : 'No disponible';
                    const uploadDate = info.upload_date ? `${info.upload_date.slice(6,8)}/${info.upload_date.slice(4,6)}/${info.upload_date.slice(0,4)}` : 'Desconocido';
                    const videoUrl = info.webpage_url || info.url;
                    const thumbUrl = info.thumbnail;

                    if (info.filesize || info.filesize_approx) {
                        const estimatedSize = info.filesize || info.filesize_approx;
                        if (estimatedSize > MAX_AUDIO_BYTES) {
                            return reply(`El archivo de audio supera el limite permitido de 20MB (Tamaño est.: ${(estimatedSize / (1024*1024)).toFixed(1)}MB). Descarga cancelada.`);
                        }
                    }

                    const infoText = `Informacion de la cancion:\n\n` +
                        `• Nombre: ${title}\n` +
                        `• Canal / Artista: ${channel}\n` +
                        `• Duracion: ${duration}\n` +
                        `• Vistas: ${views}\n` +
                        `• Likes: ${likes}\n` +
                        `• Lanzamiento: ${uploadDate}\n` +
                        `• Link: ${videoUrl}`;

                    const outputAudio = path.join(process.cwd(), `audio_${Date.now()}.mp3`);
                    await execAsync(`yt-dlp --concurrent-fragments 4 -x --audio-format mp3 -o "${outputAudio}" "${videoUrl}"`);

                    const fileStats = await stat(outputAudio).catch(() => null);
                    if (fileStats && fileStats.size > MAX_AUDIO_BYTES) {
                        await unlink(outputAudio).catch(() => {});
                        return reply(`El audio descargado excede el limite de 20MB (${(fileStats.size / (1024*1024)).toFixed(1)}MB). No se enviara.`);
                    }

                    if (thumbUrl) {
                        await sock.sendMessage(sender, {
                            image: { url: thumbUrl },
                            caption: infoText
                        }, { quoted: m });
                    } else {
                        await reply(infoText);
                    }

                    await sock.sendMessage(sender, { audio: { url: outputAudio }, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
                    await unlink(outputAudio).catch(() => {});
                } catch (err) {
                    console.error('Error en .play:', err);
                    await reply('Error al procesar la peticion con yt-dlp.');
                }
                return;
            }

            // === PLAY2 (VIDEO/SHORTS EN 720P) ===
            if (command === 'play2') {
                await react('🫰');
                if (!q) return reply('Ingresa el nombre, link o Short de YouTube.\nEjemplo: .play2 https://youtube.com/shorts/...');
                try {
                    await reply('Buscando y descargando video/short en 720p...');

                    let cleanUrl = q.trim();
                    if (!cleanUrl.startsWith('http')) {
                        const jsonCmd = `yt-dlp -j --skip-download "ytsearch1:${cleanUrl}"`;
                        const { stdout } = await execAsync(jsonCmd);
                        const info = JSON.parse(stdout.trim().split('\n')[0]);
                        cleanUrl = info.webpage_url || info.url;
                    }

                    const outputVideo = path.join(process.cwd(), `play2_${Date.now()}.mp4`);

                    await execAsync(`yt-dlp --no-check-certificates --geo-bypass --concurrent-fragments 4 -f "b[height<=720]/best[height<=720]/best" -o "${outputVideo}" "${cleanUrl}"`);

                    await sock.sendMessage(sender, { 
                        video: { url: outputVideo }, 
                        caption: 'Video/Short descargado correctamente en 720p.'
                    }, { quoted: m });

                    await unlink(outputVideo).catch(() => {});
                } catch (err) {
                    console.error('Error detallado en .play2:', err);
                    await reply('Error al descargar el video o Short.');
                }
                return;
            }

            // === VIDEO (DESCARGA GLOBAL UNIVERSAL SIN LÍMITES) ===
            if (command === 'video') {
                await react('🫰');
                if (!q || !q.startsWith('http')) {
                    return reply('Ingresa un enlace valido enviado desde cualquier aplicacion o pagina web.');
                }
                try {
                    await reply('Descargando video...');
                    const outputVideo = path.join(process.cwd(), `video_${Date.now()}.mp4`);
                    
                    await execAsync(`yt-dlp --no-check-certificates --geo-bypass --concurrent-fragments 4 -f "b/best" -o "${outputVideo}" "${q}"`);

                    await sock.sendMessage(sender, { 
                        video: { url: outputVideo }, 
                        caption: 'Video descargado correctamente.' 
                    }, { quoted: m });

                    await unlink(outputVideo).catch(() => {});
                } catch (err) {
                    console.error('Error en .video:', err);
                    await reply('Error al descargar el video.');
                }
                return;
            }

            // === SOUNDCLOUD (.sc CON LÍMITE STRICTO DE 20MB) ===
            if (command === 'sc') {
                await react('🫰');
                if (!q) return reply('Ingresa la busqueda o link de SoundCloud.\nEjemplo: .sc phonk');
                try {
                    await reply('Buscando en SoundCloud...');

                    const querySearch = q.startsWith('http') ? q : `scsearch1:${q}`;
                    const jsonCmd = `yt-dlp -j --skip-download "${querySearch}"`;
                    const { stdout } = await execAsync(jsonCmd);
                    const info = JSON.parse(stdout.trim().split('\n')[0]);

                    const title = info.title || 'Desconocido';
                    const uploader = info.uploader || info.channel || 'Desconocido';
                    const duration = formatDuration(info.duration);
                    const views = info.view_count ? info.view_count.toLocaleString() : 'No disponible';
                    const likes = info.like_count ? info.like_count.toLocaleString() : 'No disponible';
                    const uploadDate = info.upload_date ? `${info.upload_date.slice(6,8)}/${info.upload_date.slice(4,6)}/${info.upload_date.slice(0,4)}` : 'Desconocido';
                    const trackUrl = info.webpage_url || info.url;
                    const thumbUrl = info.thumbnail;

                    if (info.filesize || info.filesize_approx) {
                        const estimatedSize = info.filesize || info.filesize_approx;
                        if (estimatedSize > MAX_AUDIO_BYTES) {
                            return reply(`El audio de SoundCloud supera el limite de 20MB (${(estimatedSize / (1024*1024)).toFixed(1)}MB). Cancelado.`);
                        }
                    }

                    const infoText = `Informacion de SoundCloud:\n\n` +
                        `• Titulo: ${title}\n` +
                        `• Artista: ${uploader}\n` +
                        `• Duracion: ${duration}\n` +
                        `• Reproducciones: ${views}\n` +
                        `• Likes: ${likes}\n` +
                        `• Lanzamiento: ${uploadDate}\n` +
                        `• Link: ${trackUrl}`;

                    const outputAudio = path.join(process.cwd(), `sc_${Date.now()}.mp3`);
                    await execAsync(`yt-dlp --concurrent-fragments 4 -x --audio-format mp3 -o "${outputAudio}" "${trackUrl}"`);

                    const fileStats = await stat(outputAudio).catch(() => null);
                    if (fileStats && fileStats.size > MAX_AUDIO_BYTES) {
                        await unlink(outputAudio).catch(() => {});
                        return reply(`El audio descargado supera los 20MB (${(fileStats.size / (1024*1024)).toFixed(1)}MB). Cancelado.`);
                    }

                    if (thumbUrl) {
                        await sock.sendMessage(sender, {
                            image: { url: thumbUrl },
                            caption: infoText
                        }, { quoted: m });
                    } else {
                        await reply(infoText);
                    }

                    await sock.sendMessage(sender, { audio: { url: outputAudio }, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
                    await unlink(outputAudio).catch(() => {});
                } catch (err) {
                    console.error('Error en .sc:', err);
                    await reply('Error al obtener el archivo de SoundCloud.');
                }
                return;
            }

            // === TIKTOK (.tt SIN LÍMITES) ===
            if (command === 'tt') {
                await react('🫰');
                if (!q || !q.startsWith('http')) {
                    return reply('Por favor ingresa un enlace valido de TikTok.\nEjemplo: .tt https://vm.tiktok.com/...');
                }
                try {
                    await reply('Descargando video de TikTok...');
                    const outputVideo = path.join(process.cwd(), `tt_${Date.now()}.mp4`);
                    await execAsync(`yt-dlp --concurrent-fragments 4 -f b -o "${outputVideo}" "${q}"`);
                    await sock.sendMessage(sender, { video: { url: outputVideo }, caption: 'Video de TikTok descargado' }, { quoted: m });
                    await unlink(outputVideo).catch(() => {});
                } catch (err) {
                    console.error('Error en .tt:', err);
                    await reply('Error al descargar el video de TikTok.');
                }
                return;
            }

            // === INSTAGRAM (.ig SIN LÍMITES) ===
            if (command === 'ig') {
                await react('🫰');
                if (!q) return reply('Ingresa el enlace de Instagram.\nEjemplo: .ig https://www.instagram.com/...');
                try {
                    await reply('Descargando contenido de Instagram...');
                    const outputVideo = path.join(process.cwd(), `ig_${Date.now()}.mp4`);
                    await execAsync(`yt-dlp --concurrent-fragments 4 -f b -o "${outputVideo}" "${q}"`);
                    await sock.sendMessage(sender, { video: { url: outputVideo }, caption: 'Contenido de Instagram descargado' }, { quoted: m });
                    await unlink(outputVideo).catch(() => {});
                } catch (err) {
                    console.error('Error en .ig:', err);
                    await reply('Error al descargar de Instagram.');
                }
                return;
            }

            // === FACEBOOK (.fb SIN LÍMITES) ===
            if (command === 'fb') {
                await react('🫰');
                if (!q) return reply('Ingresa el enlace de Facebook.\nEjemplo: .fb https://www.facebook.com/...');
                try {
                    await reply('Descargando video de Facebook...');
                    const outputVideo = path.join(process.cwd(), `fb_${Date.now()}.mp4`);
                    await execAsync(`yt-dlp --concurrent-fragments 4 -f b -o "${outputVideo}" "${q}"`);
                    await sock.sendMessage(sender, { video: { url: outputVideo }, caption: 'Video de Facebook descargado' }, { quoted: m });
                    await unlink(outputVideo).catch(() => {});
                } catch (err) {
                    console.error('Error en .fb:', err);
                    await reply('Error al descargar de Facebook.');
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
