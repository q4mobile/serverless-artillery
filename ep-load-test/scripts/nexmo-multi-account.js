/**
 * Multi-Account Vonage/Nexmo Support
 *
 * This module manages Vonage accounts to achieve higher call rates
 * by distributing calls across accounts in a round-robin fashion.
 *
 * Each Vonage account has a rate limit (typically 3 calls/sec).
 * By using N accounts, you can achieve N * 3 calls/sec.
 *
 * Configuration via environment variable NEXMO_ACCOUNTS_JSON:
 *   JSON array of account configs. Use array with one element for single account.
 *   Example:
 *     [
 *       { "name": "Account 1", "apiKey": "...", "apiSecret": "...", 
 *         "applicationId": "...", "privateKeyPath": "...", "fromNumber": "..." },
 *       { "name": "Account 2", ... }
 *     ]
 */

const fs = require("fs");
const path = require("path");
const { Vonage } = require("@vonage/server-sdk");
const jwt = require("jsonwebtoken");

let accounts = [];
let vonageClients = [];
let accountIndex = 0;

function parseAccountsFromEnv() {
  const accountsJson = process.env.NEXMO_ACCOUNTS_JSON;
  
  if (!accountsJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(accountsJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((acc, i) => ({
        name: acc.name || `Account ${i + 1}`,
        apiKey: acc.apiKey,
        apiSecret: acc.apiSecret,
        applicationId: acc.applicationId,
        privateKeyPath: acc.privateKeyPath,
        fromNumber: acc.fromNumber,
      }));
    }
  } catch (error) {
    throw new Error(`Failed to parse NEXMO_ACCOUNTS_JSON: ${error.message}`);
  }

  return [];
}

function initMultiAccountClients() {
  accounts = parseAccountsFromEnv();
  
  if (accounts.length === 0) {
    throw new Error(
      "No Vonage accounts configured.\n" +
      "Set NEXMO_ACCOUNTS_JSON with a JSON array of account configurations.\n" +
      "Example: '[{\"name\": \"Account 1\", \"apiKey\": \"...\", ...}]'"
    );
  }

  vonageClients = accounts.map((account, index) => {
    try {
      const privateKey = fs.readFileSync(path.resolve(account.privateKeyPath));
      
      const client = new Vonage({
        apiKey: account.apiKey,
        apiSecret: account.apiSecret,
        applicationId: account.applicationId,
        privateKey,
      });

      return {
        index,
        name: account.name,
        client,
        fromNumber: account.fromNumber,
        applicationId: account.applicationId,
        privateKey,
        callCount: 0,
        errorCount: 0,
      };
    } catch (error) {
      console.error(`Failed to initialize account ${account.name}: ${error.message}`);
      return null;
    }
  }).filter(Boolean);

  if (vonageClients.length === 0) {
    throw new Error("Failed to initialize any Vonage accounts");
  }

  console.log(`\n🔐 Initialized ${vonageClients.length} Vonage account(s):`);
  vonageClients.forEach((vc, i) => {
    const number = vc.fromNumber ? vc.fromNumber.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2") : "N/A";
    console.log(`   ${i + 1}. ${vc.name}: ${number}`);
  });
  
  const theoreticalRate = vonageClients.length * 3;
  console.log(`   📈 Theoretical max rate: ${theoreticalRate} calls/sec (${vonageClients.length} × 3)\n`);

  return vonageClients;
}

function getNextClient() {
  if (vonageClients.length === 0) {
    throw new Error("No Vonage clients initialized. Call initMultiAccountClients() first.");
  }

  const clientInfo = vonageClients[accountIndex];
  accountIndex = (accountIndex + 1) % vonageClients.length;
  clientInfo.callCount++;
  
  return clientInfo;
}

function getClientByIndex(index) {
  if (index < 0 || index >= vonageClients.length) {
    throw new Error(`Invalid client index: ${index}`);
  }
  return vonageClients[index];
}

const jwtCache = new Map();

function getJwtForAccount(clientInfo) {
  const cacheKey = clientInfo.applicationId;
  const cached = jwtCache.get(cacheKey);
  
  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }

  const claims = {
    application_id: clientInfo.applicationId,
    iat: Math.floor(Date.now() / 1000),
    jti: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  };

  const token = jwt.sign(claims, clientInfo.privateKey, { 
    algorithm: "RS256", 
    expiresIn: "1h" 
  });
  
  jwtCache.set(cacheKey, {
    token,
    expiry: Date.now() + 55 * 60 * 1000,
  });

  return token;
}

function getAccountStats() {
  return vonageClients.map(vc => ({
    name: vc.name,
    index: vc.index,
    callCount: vc.callCount,
    errorCount: vc.errorCount,
    fromNumber: vc.fromNumber,
  }));
}

function recordAccountError(clientInfo) {
  if (clientInfo && clientInfo.index !== undefined) {
    vonageClients[clientInfo.index].errorCount++;
  }
}

function getAccountCount() {
  return vonageClients.length;
}

function isMultiAccountMode() {
  return vonageClients.length > 1;
}

module.exports = {
  initMultiAccountClients,
  getNextClient,
  getClientByIndex,
  getJwtForAccount,
  getAccountStats,
  recordAccountError,
  getAccountCount,
  isMultiAccountMode,
};

