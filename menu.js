	import fs from 'fs';

let bannerPersonalizado = './banner.jpg';

export function setBannerUrl(path) {
    bannerPersonalizado = path;
}

export async function mostrarMenu(sock, chat, m) {
    const textoMenu = `MENU PRINCIPAL

[Utilidades]
> .menu / .help - Muestra este panel
> .ping - Comprueba la latencia del bot
> .toimg - Convierte stickers en imagen (respondiendo)
> .setbanner - Actualiza el banner del sistema (respondiendo)

[Multimedia]
> .play [nombre] - Descarga audio de YouTube
> .sc [búsqueda] - Descarga pista de SoundCloud
> .ig [link] - Descarga video de Instagram
> .tt [link] - Descarga video de TikTok

[Entretenimiento]
> .menujuegos - Despliega el catálogo de juegos`;

    if (fs.existsSync(bannerPersonalizado)) {
        await sock.sendMessage(chat, { 
            image: fs.readFileSync(bannerPersonalizado), 
            caption: textoMenu 
        }, { quoted: m });
    } else {
        await sock.sendMessage(chat, { text: textoMenu }, { quoted: m });
    }
}

export async function mostrarMenuJuegos(sock, chat, m) {
    const textoJuegos = `CATÁLOGO DE JUEGOS

[Comandos Interactivos]
> .ppt - Piedra, papel o tijera (responde al mensaje)
> .8ball [pregunta] - Bola mágica de predicciones
> .dado - Lanzamiento de dado numérico (1-6)
> .caracruz - Lanza una moneda al aire
> .adivina [1-10] - Acierta el número oculto
> .chiste - Muestra una broma aleatoria
> .rollwaifu - Sistema gacha de personajes
> .hack [@usuario] - Simulación de hackeo
> .piropo - Frases y cumplidos al azar
> .ruleta - Ruleta rusa interactiva

Escribe el comando en el chat para interactuar.`;

    if (fs.existsSync(bannerPersonalizado)) {
        await sock.sendMessage(chat, { 
            image: fs.readFileSync(bannerPersonalizado), 
            caption: textoJuegos 
        }, { quoted: m });
    } else {
        await sock.sendMessage(chat, { text: textoJuegos }, { quoted: m });
    }
}

