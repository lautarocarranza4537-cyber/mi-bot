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

    let phoneNumber = process.env.PHONE_NUMBER || "";
    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

    if (!sock.authState.creds.registered) {
        if (!phoneNumber) {
            console.log('\nCONFIGURACION DE EMPAREJAMIENTO');
            phoneNumber = await askQuestion('Ingresa tu numero de WhatsApp (ej: 549351XXXXXXXX): ');
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        }

        try { rl.close(); } catch {}
        console.log('Conectando y solicitando codigo de emparejamiento...');

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
            console.log('Bot conectado y listo en la nube.');
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

            // === 1. EJECUTOR JAVASCRIPT / EVAL AL VUELO (Símbolo '>') ===
            if (text.startsWith('>')) {
                let code = text.slice(1).trim();
                code = code.replace(/print\((.*?)\)/g, 'console.log($1)');

                try {
                    let output = '';
                    const customConsole = {
                        log: (...args: any[]) => {
                            output += args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ') + '\n';
                        }
                    };
                    
                    let evaled;
                    try {
                        evaled = await eval(`(async (console) => { ${code.includes('return') ? code : 'return ' + code} })(customConsole)`);
                    } catch {
                        await eval(`(async (console) => { ${code} })(customConsole)`);
                    }

                    if (evaled !== undefined && !output) {
                        output = typeof evaled === 'object' ? JSON.stringify(evaled, null, 2) : String(evaled);
                    }

                    await reply(`*Salida (JS):*\n\`\`\`\n${output.trim() || 'Ejecutado sin salida'}\n\`\`\``);
                } catch (e: any) {
                    await reply(`*Error (JS):*\n\`\`\`\n${e.message}\n\`\`\``);
                }
                return;
            }

            // === 2. EJECUTOR PYTHON 3 (.py) ===
            if (text.startsWith('.py')) {
                const code = text.slice(3).trim();
                if (!code) return reply('❌ Escribe código Python después de `.py`');

                const tmpFile = path.join(process.cwd(), `temp_${Date.now()}.py`);
                await writeFile(tmpFile, code);

                try {
                    const { stdout, stderr } = await execAsync(`python3 ${tmpFile}`, { timeout: 10000 });
                    await unlink(tmpFile);

                    let res = '';
                    if (stdout) res += `*Salida (Python):*\n\`\`\`\n${stdout.trim()}\n\`\`\`\n`;
                    if (stderr) res += `*Error (Python):*\n\`\`\`\n${stderr.trim()}\n\`\`\`\n`;
                    if (!stdout && !stderr) res = '✅ Ejecutado con éxito sin salida explícita.';

                    await reply(res);
                } catch (error: any) {
                    if (await readFile(tmpFile).catch(() => null)) await unlink(tmpFile);
                    await reply(`*Error de ejecución Python:*\n\`\`\`\n${error.message}\n\`\`\``);
                }
                return;
            }

            // Validación de comandos tradicionales (. o , o +)
            if (!text.startsWith('.') && !text.startsWith(',') && !text.startsWith('+')) return;

            const args = text.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const q = args.join(' ');

            // === COMANDO OWNER / CREADOR ===
            if (command === 'owner' || command === 'creador' || command === 'contacto') {
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
                const menuText = `*MENÚ DE COMANDOS*
*Prefijos permitidos:* \`.\` \`,\` \`+\` \`>\`

*ENTORNO DE PROGRAMACIÓN*
• \`> [código]\` ➔ *Ejecuta JavaScript al vuelo.*
• \`.py [código]\` ➔ *Ejecuta Python 3 completo.*

*UTILIDADES Y SISTEMA*
• \`.ping\` ➔ *Muestra la latencia.*
• \`.owner\` ➔ *Muestra la tarjeta de contacto de Jonathan | Owner.*
• \`.setbanner\` ➔ *Guarda foto, GIF o video citado como banner.*

*MULTIMEDIA Y STICKERS*
• \`.s\` o \`.sticker\` ➔ *Convierte foto o video en sticker.*
• \`.toimg\` ➔ *Convierte sticker a imagen.*
• \`.revelar\` ➔ *Muestra fotos o videos de una sola vez.*

*DESCARGAS Y STREAMING*
• \`.play [búsqueda/link]\` ➔ *Busca y descarga música con detalles.*
• \`.play2 [búsqueda/link]\` ➔ *Descarga exclusiva de audio de YouTube.*
• \`.video [link]\` ➔ *🌐 Descarga universal de CUALQUIER app o página web.*
• \`.sc [búsqueda/link]\` ➔ *Audios de SoundCloud.*
• \`.tt [link]\` ➔ *Videos de TikTok.*
• \`.ig [link]\` ➔ *Contenido de Instagram.*
• \`.fb [link]\` ➔ *Videos de Facebook.*`;

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
                const start = Date.now();
                const sentMsg = await reply('Calculando ping...');
                const latencia = Date.now() - start;
                await sock.sendMessage(sender, { text: `Pong\nLatencia: *${latencia} ms*`, edit: sentMsg.key });
                return;
            }

            // === SETBANNER MEJORADO ===
            if (command === 'setbanner') {
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
                    await execAsync(`ffmpeg -i "${inputPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-ih)/2:(oh-ih)/2:color=0x00000000" -y "${outputPath}"`);

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

            // === PLAY (Música de YouTube) ===
            if (command === 'play') {
                if (!q) return reply('Escribe el nombre o link de la cancion.\nEjemplo: .play Bad Bunny');
                try {
                    await reply('🔎 Buscando información y procesando audio...');

                    const querySearch = q.startsWith('http') ? q : `ytsearch1:${q}`;
                    const jsonCmd = `yt-dlp -j --skip-download "${querySearch}"`;
                    const { stdout } = await execAsync(jsonCmd);
                    const info = JSON.parse(stdout.trim().split('\n')[0]);

                    const title = info.title || 'Desconocido';
                    const channel = info.uploader || info.channel || 'Desconocido';
                    const duration = formatDuration(info.duration);
                    const videoUrl = info.webpage_url || info.url;
                    const thumbUrl = info.thumbnail;

                    const infoText = `🎵 *Información de la canción:*\n\n` +
                        `• *Nombre:* ${title}\n` +
                        `• *Artista:* ${channel}\n` +
                        `• *Duración:* ${duration}\n` +
                        `• *Link:* ${videoUrl}`;

                    const outputAudio = path.join(process.cwd(), `audio_${Date.now()}.mp3`);
                    await execAsync(`yt-dlp -x --audio-format mp3 -o "${outputAudio}" "${videoUrl}"`);

                    if (thumbUrl) {
                        await sock.sendMessage(sender, { image: { url: thumbUrl }, caption: infoText }, { quoted: m });
                    } else {
                        await reply(infoText);
                    }

                    await sock.sendMessage(sender, { audio: { url: outputAudio }, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
                    await unlink(outputAudio).catch(() => {});
                } catch (err) {
                    console.error('Error en .play:', err);
                    await reply('❌ Error al procesar la canción de YouTube.');
                }
                return;
            }

            // === PLAY2 (EXCLUSIVO PARA AUDIO DE YOUTUBE) ===
            if (command === 'play2') {
                if (!q) return reply('❌ Ingresa el nombre o enlace de YouTube.\nEjemplo: `.play2 https://youtube.com/watch?v=...` o `.play2 Phonk`');
                try {
                    await reply('🎵 *Descargando audio de YouTube en alta calidad...*');

                    const querySearch = q.startsWith('http') ? q : `ytsearch1:${q}`;
                    const jsonCmd = `yt-dlp -j --skip-download "${querySearch}"`;
                    const { stdout } = await execAsync(jsonCmd);
                    const info = JSON.parse(stdout.trim().split('\n')[0]);

                    const title = info.title || 'Desconocido';
                    const videoUrl = info.webpage_url || info.url;

                    const outputAudio = path.join(process.cwd(), `play2_${Date.now()}.mp3`);
                    await execAsync(`yt-dlp -x --audio-format mp3 -o "${outputAudio}" "${videoUrl}"`);

                    await sock.sendMessage(sender, { 
                        audio: { url: outputAudio }, 
                        mimetype: 'audio/mp4', 
                        ptt: false
                    }, { quoted: m });

                    await unlink(outputAudio).catch(() => {});
                } catch (err) {
                    console.error('Error en .play2:', err);
                    await reply('❌ Error al descargar el audio con .play2.');
                }
                return;
            }

            // === VIDEO (DESCARGA UNIVERSAL DE CUALQUIER APP O PÁGINA WEB) ===
            if (command === 'video') {
                if (!q || !q.startsWith('http')) {
                    return reply('❌ Por favor ingresa un enlace válido enviado desde cualquier app o página web.\nEjemplo: `.video https://vm.tiktok.com/...` o `.video https://pin.it/...`');
                }
                try {
                    await reply('📱 *Procesando enlace universal de app/web y descargando video...*');
                    const outputVideo = path.join(process.cwd(), `video_${Date.now()}.mp4`);
                    
                    // Configuración omnicanal: sigue redirecciones de apps, ignora SSL y extrae de cualquier plataforma
                    await execAsync(`yt-dlp --no-check-certificates --geo-bypass --concurrent-fragments 4 -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" -o "${outputVideo}" "${q}"`);

                    await sock.sendMessage(sender, { 
                        video: { url: outputVideo }, 
                        caption: '✅ *Video descargado exitosamente desde la aplicación/web.*' 
                    }, { quoted: m });

                    await unlink(outputVideo).catch(() => {});
                } catch (err) {
                    console.error('Error en .video universal:', err);
                    await reply('❌ No se pudo extraer el video de ese enlace. Verifica que la publicación o video sea público.');
                }
                return;
            }

            // === SOUNDCLOUD (.sc) ===
            if (command === 'sc') {
                if (!q) return reply('Ingresa la busqueda o link de SoundCloud.');
                try {
                    await reply('Buscando en SoundCloud...');
                    const querySearch = q.startsWith('http') ? q : `scsearch1:${q}`;
                    const jsonCmd = `yt-dlp -j --skip-download "${querySearch}"`;
                    const { stdout } = await execAsync(jsonCmd);
                    const info = JSON.parse(stdout.trim().split('\n')[0]);
                    const trackUrl = info.webpage_url || info.url;

                    const outputAudio = path.join(process.cwd(), `sc_${Date.now()}.mp3`);
                    await execAsync(`yt-dlp -x --audio-format mp3 -o "${outputAudio}" "${trackUrl}"`);

                    await sock.sendMessage(sender, { audio: { url: outputAudio }, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
                    await unlink(outputAudio).catch(() => {});
                } catch (err) {
                    await reply('Error al obtener el archivo de SoundCloud.');
                }
                return;
            }

            // === TIKTOK (.tt) ===
            if (command === 'tt') {
                if (!q || !q.startsWith('http')) return reply('Ingresa un enlace valido de TikTok.');
                try {
                    await reply('Descargando video de TikTok...');
                    const outputVideo = path.join(process.cwd(), `tt_${Date.now()}.mp4`);
                    await execAsync(`yt-dlp -f mp4 -o "${outputVideo}" "${q}"`);
                    await sock.sendMessage(sender, { video: { url: outputVideo }, caption: 'Video de TikTok' }, { quoted: m });
                    await unlink(outputVideo).catch(() => {});
                } catch (err) {
                    await reply('Error al descargar de TikTok.');
                }
                return;
            }

            // === INSTAGRAM (.ig) ===
            if (command === 'ig') {
                if (!q) return reply('Ingresa el enlace de Instagram.');
                try {
                    await reply('Descargando contenido de Instagram...');
                    const outputVideo = path.join(process.cwd(), `ig_${Date.now()}.mp4`);
                    await execAsync(`yt-dlp -f mp4 -o "${outputVideo}" "${q}"`);
                    await sock.sendMessage(sender, { video: { url: outputVideo }, caption: 'Contenido de Instagram' }, { quoted: m });
                    await unlink(outputVideo).catch(() => {});
                } catch (err) {
                    await reply('Error al descargar de Instagram.');
                }
                return;
            }

            // === FACEBOOK (.fb) ===
            if (command === 'fb') {
                if (!q) return reply('Ingresa el enlace de Facebook.');
                try {
                    await reply('Descargando video de Facebook...');
                    const outputVideo = path.join(process.cwd(), `fb_${Date.now()}.mp4`);
                    await execAsync(`yt-dlp -f mp4 -o "${outputVideo}" "${q}"`);
                    await sock.sendMessage(sender, { video: { url: outputVideo }, caption: 'Video de Facebook' }, { quoted: m });
                    await unlink(outputVideo).catch(() => {});
                } catch (err) {
                    await reply('Error al descargar de Facebook.');
                }
                return;
            }

            // === REVELAR ===
            if (command === 'revelar' || command === 'read') {
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
