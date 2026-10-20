// Asegurarnos de obtener el número desde la variable de entorno de Render
let phoneNumber = process.env.PHONE_NUMBER || "5493513157041";
phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

if (!sock.authState.creds.registered) {
  setTimeout(async () => {
    try {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log("========================================");
      console.log("TU CODIGO DE EMPAREJAMIENTO ES: " + code);
      console.log("========================================");
    } catch (err) {
      console.error("Error al solicitar codigo de emparejamiento:", err);
    }
  }, 3000);
}
