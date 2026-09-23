#!/data/data/com.termux/files/usr/bin/bash

echo "[*] Actualizando paquetes de Termux..."
pkg update -y && pkg upgrade -y

echo "[*] Instalando Node.js, Git, Python y dependencias del sistema..."
pkg install nodejs git python python-pip clang make libjpeg-turbo zlib -y

echo "[*] Instalando dependencias de Node.js..."
npm install

echo "[*] Instalando librerías de Python necesarias (Pillow, etc.)..."
pip install Pillow

echo "[+] ¡Instalación completa! Todo listo para funcionar."
echo "[+] Ejecuta 'npm start' para iniciar tu bot."

