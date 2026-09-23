import makeWASocket, { useMultiFileAuthState, downloadMediaMessage, makeCacheableSignalKeyStore } from 'baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import readline from 'readline';
import fs from 'fs';
import { exec } from 'child_process';
import { mostrarMenu, mostrarMenuJuegos, setBannerUrl } from './menu.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        logger: P({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (!sock.authState.creds.registered) {
            const phoneNumber = await question('Ingresa tu numero con codigo de pais (ej: 549...):\n');
            const code = await sock.requestPairingCode(phoneNumber.trim());
            console.log(`Tu codigo de emparejamiento de 8 digitos es: ${code}`);
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== 401;
            console.log('Conexion cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('¡Bot conectado exitosamente!');
            rl.close();
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message) return;

            const chat = m.key.remoteJid;

            const messageType = Object.keys(m.message)[0];
            let body = '';

            if (messageType === 'conversation') {
                body = m.message.conversation;
            } else if (messageType === 'extendedTextMessage') {
                body = m.message.extendedTextMessage.text;
            } else if (messageType === 'imageMessage') {
                body = m.message.imageMessage.caption || '';
            } else if (messageType === 'videoMessage') {
                body = m.message.videoMessage.caption || '';
            }

            if (m.key.fromMe) return;

            const prefix = '.';
            const isCommand = body.startsWith(prefix);
            if (!isCommand) {
                const quotedContext = m.message?.extendedTextMessage?.contextInfo;
                if (quotedContext && quotedContext.stanzaId) {
                    const textoMensaje = body.toLowerCase().trim();
                    if (['piedra', 'papel', 'tijera', 'tijeras'].includes(textoMensaje)) {
                        const opciones = ['piedra', 'papel', 'tijera'];
                        const botEleccion = opciones[Math.floor(Math.random() * opciones.length)];
                        let usuarioEleccion = textoMensaje === 'tijeras' ? 'tijera' : textoMensaje;
                        
                        let resultado = '';
                        if (usuarioEleccion === botEleccion) {
                            resultado = '¡Empate 🤝!';
                        } else if (
                            (usuarioEleccion === 'piedra' && botEleccion === 'tijera') ||
                            (usuarioEleccion === 'papel' && botEleccion === 'piedra') ||
                            (usuarioEleccion === 'tijera' && botEleccion === 'papel')
                        ) {
                            resultado = '¡Ganaste 🎉!';
                        } else {
                            resultado = '¡Perdiste 😢!';
                        }

                        await sock.sendMessage(chat, { 
                            text: `🎯 *RESULTADO PPT*\n\nTu elección: ${usuarioEleccion}\nMi elección: ${botEleccion}\n\n*${resultado}*` 
                        }, { quoted: m });
                    }
                }
                return;
            }

            const command = body.slice(prefix.length).trim().split(' ')[0].toLowerCase();
            const args = body.slice(prefix.length).trim().split(' ').slice(1);

            if (command === 'menu' || command === 'help') {
                await mostrarMenu(sock, chat, m);
            }

            if (command === 'menujuegos' || command === 'juegos') {
                await mostrarMenuJuegos(sock, chat, m);
            }

            if (command === 'ping') {
                const timestampInicio = Date.now();
                await sock.sendMessage(chat, { text: 'Calculando velocidad...' }, { quoted: m });
                const timestampFin = Date.now();
                const velocidadMs = timestampFin - timestampInicio;

                await sock.sendMessage(chat, { 
                    text: `pong\nVelocidad: ${velocidadMs} ms` 
                }, { quoted: m });
            }

            if (command === 'toimg') {
                const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const isQuotedSticker = quoted && quoted.stickerMessage;
                const isSticker = m.message?.stickerMessage;

                if (isQuotedSticker || isSticker) {
                    try {
                        let msgToDownload = m;
                        if (quoted && quoted.stickerMessage) {
                            msgToDownload = {
                                key: {
                                    remoteJid: chat,
                                    id: m.message.extendedTextMessage.contextInfo.stanzaId,
                                    participant: m.message.extendedTextMessage.contextInfo.participant
                                },
                                message: quoted
                            };
                        }

                        const stream = await downloadMediaMessage(msgToDownload, 'buffer');
                        
                        await sock.sendMessage(chat, { 
                            image: stream, 
                            caption: 'Aqui tienes tu sticker convertido a imagen.' 
                        }, { quoted: m });
                    } catch (error) {
                        console.error('Error detallado en toimg:', error);
                        await sock.sendMessage(chat, { text: 'Hubo un error al convertir el sticker.' }, { quoted: m });
                    }
                } else {
                    await sock.sendMessage(chat, { text: 'Responde a un sticker con el comando .toimg para convertirlo.' }, { quoted: m });
                }
            }
            if (command === 'setbanner') {
                const quotedMessage = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                
                if (quotedMessage && quotedMessage.imageMessage) {
                    try {
                        const builtinMsg = {
                            key: {
                                remoteJid: chat,
                                id: m.message.extendedTextMessage.contextInfo.stanzaId,
                                participant: m.message.extendedTextMessage.contextInfo.participant
                            },
                            message: quotedMessage
                        };

                        const stream = await downloadMediaMessage(builtinMsg, 'buffer');
                        const bannerPath = './banner.jpg';
                        fs.writeFileSync(bannerPath, stream);
                        setBannerUrl(bannerPath);

                        await sock.sendMessage(chat, { text: '¡Banner del bot actualizado exitosamente!' }, { quoted: m });
                    } catch (error) {
                        console.error(error);
                        await sock.sendMessage(chat, { text: 'Hubo un error al establecer el banner.' }, { quoted: m });
                    }
                } else {
                    await sock.sendMessage(chat, { text: 'Responde a una imagen con el comando .setbanner para cambiar el banner del menu.' }, { quoted: m });
                }
            }

            if (command === '8ball') {
                const pregunta = args.join(' ');
                if (!pregunta) {
                    await sock.sendMessage(chat, { text: 'Escribe una pregunta. Ejemplo: .8ball aprobare el año?' }, { quoted: m });
                    return;
                }
                const respuestas = [
                    'Si, definitivamente.', 'Es cierto.', 'Sin duda.',
                    'No cuentes con ello.', 'Mi respuesta es no.', 'Mis fuentes dicen que no.',
                    'Pregunta de nuevo mas tarde.', 'No se puede predecir ahora.'
                ];
                const respuestaAleatoria = respuestas[Math.floor(Math.random() * respuestas.length)];
                await sock.sendMessage(chat, { text: `🔮 *8Ball*\nPregunta: ${pregunta}\nRespuesta: ${respuestaAleatoria}` }, { quoted: m });
            }

            if (command === 'ppt') {
                await sock.sendMessage(chat, { text: '🎮 *Juego de Piedra, Papel o Tijera.*\n\nResponde a este mensaje escribiendo tu jugada: `piedra`, `papel` o `tijera`.' }, { quoted: m });
            }

            if (command === 'dado') {
                const numeroDado = Math.floor(Math.random() * 6) + 1;
                await sock.sendMessage(chat, { text: `🎲 Lanzaste el dado y salió el número: *${numeroDado}*` }, { quoted: m });
            }

            if (command === 'caracruz') {
                const resultado = Math.random() < 0.5 ? '🪙 Cara' : '🪙 Cruz';
                await sock.sendMessage(chat, { text: `La moneda giró y cayó en: *${resultado}*` }, { quoted: m });
            }

            if (command === 'adivina') {
                const numeroSecreto = Math.floor(Math.random() * 10) + 1;
                const userChoice = parseInt(args[0]);
                if (!userChoice || isNaN(userChoice)) {
                    await sock.sendMessage(chat, { text: 'Elige un número del 1 al 10. Ejemplo: `.adivina 5`' }, { quoted: m });
                    return;
                }
                if (userChoice === numeroSecreto) {
                    await sock.sendMessage(chat, { text: `🎉 ¡Felicidades! Adivinaste el número secreto (*${numeroSecreto}*).` }, { quoted: m });
                } else {
                    await sock.sendMessage(chat, { text: `❌ Fallaste. El número secreto era *${numeroSecreto}*. ¡Inténtalo de nuevo!` }, { quoted: m });
                }
            }

            if (command === 'chiste') {
                const chistes = [
                    '— Papá, papá, ¿qué se siente tener un hijo tan guapo?\n— No sé hijo, pregúntale a tu abuelo.',
                    '— ¿Qué hace una abeja en el gimnasio?\n— ¡Zumba!',
                    '— ¡Camarero, hay una mosca en mi sopa!\n— No se preocupe, señor, nadando no se ahoga.',
                    '— ¿Por qué los pájaros vuelan al sur en invierno?\n— Porque caminando tardan muchísimo.',
                    '— ¡Hola, guapo! ¿Qué hora es?\n— La hora de enamorarte de mí.'
                ];
                const chisteAleatorio = chistes[Math.floor(Math.random() * chistes.length)];
                await sock.sendMessage(chat, { text: `😂 *Chiste:* \n\n${chisteAleatorio}` }, { quoted: m });
            }

            if (command === 'rollwaifu') {
                const waifus = ['Rem (Re:Zero)', 'Nezuko (Kimetsu no Yaiba)', 'Gojo Satoru (Jujutsu Kaisen)', 'Naruto Uzumaki', 'Megumin (KonoSuba)', 'L (Death Note)'];
                const waifuObtenida = waifus[Math.floor(Math.random() * waifus.length)];
                const rarezas = ['✨ Común', '🌟 Rara', '🔥 Épica', '💎 ¡Legendaria!'];
                const rarezaObtenida = rarezas[Math.floor(Math.random() * rarezas.length)];
                await sock.sendMessage(chat, { text: `✨ *Gacha Waifu/Husbando*\n\n¡Te ha tocado: *${waifuObtenida}*!\nRareza: ${rarezaObtenida}` }, { quoted: m });
            }

            if (command === 'hack') {
                let objetivo = args.join(' ');
                const mentionedJid = m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
                
                if (mentionedJid && mentionedJid.length > 0) {
                    objetivo = `@${mentionedJid[0].split('@')[0]}`;
                } else if (!objetivo) {
                    objetivo = 'Alguien';
                }

                const mentions = mentionedJid ? mentionedJid : [];

                await sock.sendMessage(chat, { 
                    text: `💻 Hackeando a ${objetivo}...\n█ 20% - Robando datos de WhatsApp...\n████ 50% - Descargando galería secreta...\n████████ 100% - ¡Hackeo completado con éxito! (Es broma tranqui 😂)`,
                    mentions: mentions
                }, { quoted: m });
            }

            if (command === 'piropo') {
                const piropos = [
                    '¿Eres Google? Porque tienes todo lo que estoy buscando.',
                    'Si el amor fuera un delito, tú estarías cadena perpetua por robarme el corazón.',
                    '¿Crees en el amor a primera vista o tengo que volver a pasar frente a ti?',
                    'Debes ser un ladrón, porque te robaron una sonrisa.'
                ];
                const piropoAleatorio = piropos[Math.floor(Math.random() * piropos.length)];
                await sock.sendMessage(chat, { text: `💖 *Piropo:* \n\n${piropoAleatorio}` }, { quoted: m });
            }

            if (command === 'ruleta') {
                const sobrevive = Math.random() > 0.33;
                if (sobrevive) {
                    await sock.sendMessage(chat, { text: '🔫 *Ruleta Rusa*\n\nApuntaste, apretaste el gatillo... ¡*Click*! Sobreviviste esta ronda. 😮‍💨' }, { quoted: m });
                } else {
                    await sock.sendMessage(chat, { text: '🔫 *Ruleta Rusa*\n\nApuntaste, apretaste el gatillo... ¡*BAM*! 💥 Te diste un tiro. Perdiste ⚰️.' }, { quoted: m });
                }
            }

            if (command === 'play') {
                const query = args.join(' ');
                if (!query) {
                    await sock.sendMessage(chat, { text: 'Escribe el nombre o link de la cancion. Ejemplo: .play despacito' }, { quoted: m });
                    return;
                }
                await sock.sendMessage(chat, { text: `🔍 Buscando y descargando audio para: "${query}"...` }, { quoted: m });

                const outputAudio = `./downloads_audio_${Date.now()}.mp3`;
                const searchCmd = `yt-dlp -x --audio-format mp3 -o "${outputAudio}" "ytsearch1:${query}"`;

                exec(searchCmd, async (error) => {
                    if (error) {
                        await sock.sendMessage(chat, { text: '❌ No se pudo descargar el audio.' }, { quoted: m });
                        return;
                    }
                    try {
                        const buffer = fs.readFileSync(outputAudio);
                        await sock.sendMessage(chat, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
                        fs.unlinkSync(outputAudio);
                    } catch (err) {
                        await sock.sendMessage(chat, { text: '❌ Error al enviar el archivo de audio.' }, { quoted: m });
                    }
                });
            }

            if (command === 'sc') {
                const query = args.join(' ');
                if (!query) {
                    await sock.sendMessage(chat, { text: 'Escribe el nombre o link de SoundCloud. Ejemplo: .sc remix' }, { quoted: m });
                    return;
                }
                await sock.sendMessage(chat, { text: `🔍 Buscando en SoundCloud: "${query}"...` }, { quoted: m });

                const outputSc = `./downloads_sc_${Date.now()}.mp3`;
                const scCmd = `yt-dlp -x --audio-format mp3 -o "${outputSc}" "scsearch1:${query}"`;

                exec(scCmd, async (error) => {
                    if (error) {
                        await sock.sendMessage(chat, { text: '❌ No se pudo descargar desde SoundCloud.' }, { quoted: m });
                        return;
                    }
                    try {
                        const buffer = fs.readFileSync(outputSc);
                        await sock.sendMessage(chat, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
                        fs.unlinkSync(outputSc);
                    } catch (err) {
                        await sock.sendMessage(chat, { text: '❌ Error al enviar el audio de SoundCloud.' }, { quoted: m });
                    }
                });
            }

            if (command === 'ig' || command === 'tt') {
                const link = args[0];
                if (!link) {
                    await sock.sendMessage(chat, { text: `Ingresa un enlace válido. Ejemplo: .${command} https://...` }, { quoted: m });
                    return;
                }
                await sock.sendMessage(chat, { text: `📥 Descargando video de ${command.toUpperCase()}...` }, { quoted: m });

                const outputVideo = `./downloads_vid_${Date.now()}.mp4`;
                const dlCmd = `yt-dlp -o "${outputVideo}" "${link}"`;

                exec(dlCmd, async (error) => {
                    if (error) {
                        await sock.sendMessage(chat, { text: '❌ No se pudo descargar el video. Verifica que el enlace sea correcto.' }, { quoted: m });
                        return;
                    }
                    try {
                        const buffer = fs.readFileSync(outputVideo);
                        await sock.sendMessage(chat, { video: buffer, caption: 'Aquí tienes tu video descargado.' }, { quoted: m });
                        fs.unlinkSync(outputVideo);
                    } catch (err) {
                        await sock.sendMessage(chat, { text: '❌ Error al enviar el video.' }, { quoted: m });
                    }
                });
            }

        } catch (error) {
            console.error('Error al procesar el mensaje:', error);
        }
    });
}

startBot();

