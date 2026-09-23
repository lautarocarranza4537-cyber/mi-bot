#!/data/data/com.termux/files/usr/bin/bash

echo "[*] Actualizando paquetes de Termux..."
pkg update -y && pkg upgrade -y

echo "[*] Instalando Node.js, Git y Python..."
pkg install nodejs git python -y

echo "[*] Instalando dependencias de Node.js..."
npm install

echo "[*] Verificando e instalando librerías de Python necesarias..."
pip install --upgrade pip

echo "[+] ¡Instalación completada con éxito!"
echo "[+] Ya puedes iniciar tu bot ejecutando: npm start"

