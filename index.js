import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

if (!fs.existsSync('./cache')) {
    fs.mkdirSync('./cache');
}

const memoryCache = new Map();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessions');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = await question('Por favor ingresa tu numero de WhatsApp (ej: 5493516609573): \n');
        const code = await sock.requestPairingCode(phoneNumber.trim());
        console.log(`Tu codigo de emparejamiento de 8 digitos es: ${code}`);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexion cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('¡Bot conectado exitosamente a WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', (chatUpdate) => {
        setImmediate(async () => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message) return;
                if (mek.key.fromMe) return;

                const body = mek.message?.conversation || mek.message?.extendedTextMessage?.text || '';
                const isCmd = body.startsWith('.');
                const command = isCmd ? body.slice(1).trim().split(' ')[0].toLowerCase() : '';
                const q = body.trim().split(' ').slice(1).join(' ');
                const from = mek.key.remoteJid;

                switch (command) {
                    case 'menu':
                    case 'help': {
                        const menuText = `¡𝐇𝐨𝐥𝐚! 𝐒𝐨𝐲 𝐭𝐮 𝐚𝐬𝐢𝐬𝐭𝐞𝐧𝐭𝐞\n` +
                                         `ᴀǫᴜɪ ᴛɪᴇɴᴇs ʟᴀ ʟɪsᴛᴀ ᴅᴇ ᴄᴏᴍᴀɴᴅᴏs\n` +
                                         `╭┈ ↷\n` +
                                         `│ ✐ 𝓓𝓮𝓿𝓮𝓵𝓸𝓹𝓮𝓭 𝓫𝔂 𝓛𝓪𝓾𝓽𝓪𝓻𝓸 ❤️\n` +
                                         `╰─────────────────\n\n` +
                                         `» ˚୨•(=^●ω●^=)• ⊹ \`Multimedia y Utilidades\` ⊹\n` +
                                         `> ✐ Comandos principales del sistema.\n\n` +
                                         `✧ \`.menu\` / \`.help\`\n> Muestra este panel de comandos.\n` +
                                         `✧ \`.ping\`\n> Muestra la latencia del bot con estilo.\n` +
                                         `✧ \`.owner\`\n> Muestra el contacto del creador.\n` +
                                         `✧ \`.runtime\`\n> Muestra el tiempo activo del sistema.\n` +
                                         `✧ \`.calc\` _[operación]_\n> Realiza una operación matemática.\n` +
                                         `✧ \`.setbanner\` _{imagen}_\n> Actualiza el banner del sistema.\n` +
                                         `✧ \`.revelar\` _{foto única}_\n> Revela fotos de ver una sola vez.\n` +
                                         `✧ \`.waifu\`\n> Envía una waifu aleatoria.\n` +
                                         `✧ \`.clear\`\n> Limpia la caché y memoria RAM.\n` +
                                         `✧ \`.play\` _[búsqueda]_\n> Descarga música HD 🎵.\n` +
                                         `✧ \`.ig\` / \`.tt\` _[enlace]_\n> Descarga videos de Instagram o TikTok.\n\n` +
                                         `» ˚୨•(=^●ω●^=)• ⊹ \`Entretenimiento y Juegos\` ⊹\n` +
                                         `> ✐ Mini juegos interactivos.\n\n` +
                                         `✧ \`.menujuegos\`\n> Muestra el catálogo de juegos.\n` +
                                         `✧ \`.8ball\` _[pregunta]_\n> Consulta a la bola mágica de respuestas.`;

                        if (fs.existsSync('./banner.jpg')) {
                            await sock.sendMessage(from, { image: fs.readFileSync('./banner.jpg'), caption: menuText }, { quoted: mek });
                        } else {
                            await sock.sendMessage(from, { text: menuText }, { quoted: mek });
                        }
                        break;
                    }

                    case 'ping': {
                        const startPing = performance.now();
                        const latency = (performance.now() - startPing).toFixed(2);
                        const pingResponse = ` ✰ ¡Pong!\n> Tiempo ⴵ ${latency}ms`;
                        await sock.sendMessage(from, { text: pingResponse }, { quoted: mek });
                        break;
                    }

                    case 'owner': {
                        await sock.sendMessage(from, {
                            contacts: {
                                displayName: 'Lautaro',
                                contacts: [{ vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Lautaro\nTEL;type=CELL;type=VOICE;waid=5493516609573:+54 9 351 660-9573\nEND:VCARD' }]
                            }
                        }, { quoted: mek });
                        break;
                    }

                    case 'runtime': {
                        const uptime = process.uptime();
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);
                        await sock.sendMessage(from, { text: `Tiempo activo del sistema: ${hours}h ${minutes}m ${seconds}s` }, { quoted: mek });
                        break;
                    }

                    case 'calc': {
                        if (!q) {
                            await sock.sendMessage(from, { text: 'Ingresa una operacion. Ejemplo: .calc 50 * 2' }, { quoted: mek });
                            break;
                        }
                        try {
                            const resultado = eval(q.replace(/[^0-9+\-*/().]/g, ''));
                            await sock.sendMessage(from, { text: `Resultado: ${resultado}` }, { quoted: mek });
                        } catch (e) {
                            await sock.sendMessage(from, { text: 'Operacion invalida.' }, { quoted: mek });
                        }
                        break;
                    }

                    case 'setbanner': {
                        try {
                            const quotedMessage = mek.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                            const isQuotedImage = quotedMessage?.imageMessage;
                            const directImage = mek.message?.imageMessage;
                            
                            if (isQuotedImage || directImage) {
                                const targetMessage = isQuotedImage ? { message: quotedMessage, key: { remoteJid: from, id: mek.message.extendedTextMessage.contextInfo.stanzaId } } : mek;
                                const buffer = await downloadMediaMessage(targetMessage, 'buffer', {});
                                fs.writeFileSync('./banner.jpg', buffer);
                                await sock.sendMessage(from, { text: 'Banner actualizado exitosamente.' }, { quoted: mek });
                            } else {
                                await sock.sendMessage(from, { text: 'Responde a una imagen con el comando .setbanner.' }, { quoted: mek });
                            }
                        } catch (err) {
                            await sock.sendMessage(from, { text: 'Hubo un error al actualizar el banner.' }, { quoted: mek });
                        }
                        break;
                    }

                    case 'revelar': {
                        try {
                            const quoted = mek.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                            if (!quoted) {
                                await sock.sendMessage(from, { text: 'Responde a una foto de ver una sola vez.' }, { quoted: mek });
                                break;
                            }
                            let viewOnceMsg = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted;
                            let imageMsg = viewOnceMsg.imageMessage;

                            if (!imageMsg) {
                                await sock.sendMessage(from, { text: 'El mensaje no es una foto válida.' }, { quoted: mek });
                                break;
                            }

                            const targetObject = {
                                key: {
                                    remoteJid: from,
                                    id: mek.message.extendedTextMessage.contextInfo.stanzaId,
                                    participant: mek.message.extendedTextMessage.contextInfo.participant
                                },
                                message: quoted
                            };

                            const buffer = await downloadMediaMessage(targetObject, 'buffer', {});
                            await sock.sendMessage(from, { image: buffer, caption: '🔓 Imagen revelada con éxito.' }, { quoted: mek });
                        } catch (e) {
                            await sock.sendMessage(from, { text: '❌ No se pudo revelar la imagen.' }, { quoted: mek });
                        }
                        break;
                    }

                    case 'waifu': {
                        try {
                            let apiURL = `https://nekos.best/api/v2/neko`;
                            let response = await fetch(apiURL);
                            let data = await response.json();
                            let imageUrl = data?.results?.[0]?.url;

                            if (!imageUrl) {
                                let fallbackRes = await fetch(`https://api.waifu.pics/sfw/waifu`);
                                let fallbackData = await fallbackRes.json();
                                imageUrl = fallbackData?.url;
                            }

                            if (!imageUrl) {
                                await sock.sendMessage(from, { text: `❌ No se pudo obtener ninguna imagen en este momento.` }, { quoted: mek });
                                break;
                            }

                            let imgRes = await fetch(imageUrl);
                            if (!imgRes.ok) throw new Error('Fallo al descargar la imagen');
                            
                            let arrayBuffer = await imgRes.arrayBuffer();
                            let buffer = Buffer.from(arrayBuffer);

                            await sock.sendMessage(from, { 
                                image: buffer, 
                                caption: `✨ Aquí tienes tu waifu aleatoria.` 
                            }, { quoted: mek });

                        } catch (e) {
                            await sock.sendMessage(from, { text: '❌ Ocurrió un error al procesar la imagen.' }, { quoted: mek });
                        }
                        break;
                    }

                    case 'clear': {
                        try {
                            memoryCache.clear();
                            const cacheDir = './cache';
                            if (!fs.existsSync(cacheDir)) {
                                await sock.sendMessage(from, { text: '📁 La caché ya está vacía.' }, { quoted: mek });
                                break;
                            }
                            const files = fs.readdirSync(cacheDir);
                            let count = 0;
                            for (const file of files) {
                                fs.unlinkSync(path.join(cacheDir, file));
                                count++;
                            }
                            await sock.sendMessage(from, { text: `🧹 Caché y RAM limpiadas. Se eliminaron ${count} archivos.` }, { quoted: mek });
                        } catch (e) {
                            await sock.sendMessage(from, { text: '❌ Ocurrió un error al limpiar la caché.' }, { quoted: mek });
                        }
                        break;
                    }

                    case 'play': {
                        if (!q) {
                            await sock.sendMessage(from, { text: 'Ingresa el nombre de la musica. Ejemplo: .play bad bunny' }, { quoted: mek });
                            break;
                        }
                        
                        try {
                            let sanitizedQuery = q.toLowerCase().replace(/[^a-z0-9]/g, '_');
                            let cacheFile = path.join('./cache', `${sanitizedQuery}.mp3`);

                            if (memoryCache.has(sanitizedQuery)) {
                                await sock.sendMessage(from, { 
                                    audio: memoryCache.get(sanitizedQuery), 
                                    mimetype: 'audio/mp4', 
                                    ptt: false,
                                    caption: `🎶 ${q}` 
                                }, { quoted: mek });
                                break;
                            }

                            if (fs.existsSync(cacheFile)) {
                                const fileBuffer = fs.readFileSync(cacheFile);
                                memoryCache.set(sanitizedQuery, fileBuffer);
                                await sock.sendMessage(from, { 
                                    audio: fileBuffer, 
                                    mimetype: 'audio/mp4', 
                                    ptt: false,
                                    caption: `🎶 ${q}` 
                                }, { quoted: mek });
                                break;
                            }

                            await sock.sendMessage(from, { text: '🎧 Buscando y procesando audio en alta calidad...' }, { quoted: mek });

                            const rawFile = `raw_${Date.now()}.webm`;
                            
                            await execPromise(`yt-dlp -f bestaudio --no-playlist --no-check-certificates -o "${rawFile}" "ytsearch1:${q}"`);
                            await execPromise(`ffmpeg -i "${rawFile}" -vn -ar 44100 -ac 2 -b:a 320k "${cacheFile}"`);

                            const finalBuffer = fs.readFileSync(cacheFile);
                            memoryCache.set(sanitizedQuery, finalBuffer);

                            await sock.sendMessage(from, { 
                                audio: finalBuffer, 
                                mimetype: 'audio/mp4', 
                                ptt: false,
                                caption: `🎶 ${q}` 
                            }, { quoted: mek });

                            if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile);

                        } catch (e) {
                            await sock.sendMessage(from, { text: '❌ Ocurrió un error al procesar la música.' }, { quoted: mek });
                        }
                        break;
                    }

                    case 'tt':
                    case 'ig': {
                        if (!q) {
                            await sock.sendMessage(from, { text: 'Ingresa un enlace valido.' }, { quoted: mek });
                            break;
                        }
                        await sock.sendMessage(from, { text: '⏳ Procesando video...' }, { quoted: mek });
                        try {
                            const fileName = `video_${Date.now()}.mp4`;
                            await execPromise(`yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${fileName}" "${q}"`);
                            await sock.sendMessage(from, { video: fs.readFileSync(fileName), mimetype: 'video/mp4', caption: '✨ Aquí tienes tu video.' }, { quoted: mek });
                            fs.unlinkSync(fileName);
                        } catch (e) {
                            await sock.sendMessage(from, { text: '❌ No se pudo descargar el video.' }, { quoted: mek });
                        }
                        break;
                    }

                    case 'menujuegos': {
                        await sock.sendMessage(from, { text: 'MENU DE JUEGOS\n| .8ball [pregunta]\n| .dado\n| .coin' }, { quoted: mek });
                        break;
                    }

                    case '8ball': {
                        if (!q) {
                            await sock.sendMessage(from, { text: 'Haz una pregunta.' }, { quoted: mek });
                            break;
                        }
                        const resp = ['Si.', 'No.', 'Tal vez.', 'Definitivamente no.', 'Por supuesto.'];
                        await sock.sendMessage(from, { text: resp[Math.floor(Math.random() * resp.length)] }, { quoted: mek });
                        break;
                    }

                    default:
                        break;
                }
            } catch (err) {
                console.error(err);
            }
        });
    });
}

startBot();
