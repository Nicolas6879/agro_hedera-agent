const { Client, PrivateKey, AccountId } = require("@hashgraph/sdk");
require("dotenv").config();

/**
 * Verify Hedera credentials from environment variables
 * Performs comprehensive validation of Hedera account credentials
 * 
 * @async
 * @function verifyHederaCredentials
 * @description Checks Hedera account credentials for correct format and validity
 */
async function verifyHederaCredentials() {
    try {
        // Retrieve credentials from environment variables
        const accountId = process.env.HEDERA_ACCOUNT_ID;
        const privateKeyString = process.env.HEDERA_PRIVATE_KEY;

        // Check if credentials are defined
        if (!accountId || !privateKeyString) {
            throw new Error("Credentials are not defined in .env file");
        }

        // Validate private key
        let privateKey;
        try {
            // Attempt to parse private key
            privateKey = PrivateKey.fromString(privateKeyString);
        } catch (error) {
            // Detailed error for invalid private key format
            throw new Error("Invalid private key format. Verify if it's in HEX or requires another format.");
        }

        // Validate Account ID
        try {
            const parsedAccountId = AccountId.fromString(accountId);
            
            // Additional validation (optional but recommended)
            if (!parsedAccountId) {
                throw new Error("Invalid Hedera Account ID");
            }
        } catch (idError) {
            throw new Error("Hedera Account ID is invalid or improperly formatted");
        }

        // Successful verification logging
        console.log("✅ Hedera Credentials Validated Successfully");
        console.log(`   Account ID: ${accountId}`);
        console.log(`   Public Key: ${privateKey.publicKey}`);

    } catch (error) {
        // Comprehensive error logging
        console.error("❌ Hedera Credentials Verification Failed:");
        console.error(`   Error: ${error.message}`);
        
        // Provide additional guidance
        console.error("\nTroubleshooting Tips:");
        console.error("1. Ensure .env file exists in project root");
        console.error("2. Verify HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are correctly set");
        console.error("3. Check private key format (HEX)");
        console.error("4. Confirm you're using a valid Hedera Testnet account");
    }
}

// Immediately invoke verification
verifyHederaCredentials();

// Export for potential programmatic use
module.exports = verifyHederaCredentials;