const { Client, PrivateKey, AccountId } = require("@hashgraph/sdk");
require("dotenv").config();

async function verifyHederaCredentials() {
    try {
        const accountId = process.env.HEDERA_ACCOUNT_ID;
        const privateKeyString = process.env.HEDERA_PRIVATE_KEY;

        if (!accountId || !privateKeyString) {
            throw new Error("Las credenciales no están definidas en .env");
        }

        // Intenta crear la clave privada desde la cadena
        let privateKey;
        try {
            privateKey = PrivateKey.fromString(privateKeyString);
        } catch (error) {
            throw new Error("Clave privada en formato incorrecto. Verifica si es HEX o necesita otro formato.");
        }

        // Verifica si el AccountId es válido
        if (!AccountId.fromString(accountId)) {
            throw new Error("El ID de cuenta de Hedera es inválido.");
        }

        console.log("✅ Credenciales de Hedera en formato correcto.");
    } catch (error) {
        console.error("❌ Error en la verificación de credenciales:", error.message);
    }
}

verifyHederaCredentials();
