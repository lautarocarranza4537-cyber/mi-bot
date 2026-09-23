#!/data/data/com.termux/files/usr/bin/bash

echo "[*] Actualizando paquetes de Termux..."
pkg update -y && pkg upgrade -y

echo "[*] Instalando Node.js, Git, Python y dependencias del sistema..."
pkg install nodejs git python clang make libjpeg-turbo zlib -y

echo "[*] Instalando dependencias de Node.js..."
npm install

echo "[*] Actualizando pip e instalando librerías de Python (Pillow, etc.)..."
pip install --upgrade pip
pip install Pillow

echo "[+] ¡Instalación completa! Todo listo para funcionar."
echo "[+] Ejecuta 'npm start' para iniciar tu bot."

