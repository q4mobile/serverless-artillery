const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { config } = require("./nexmo-pstn-config");

let cachedJwt = null;
let cachedJwtExpiry = 0;
let cachedPrivateKey = null;

function getVonageJwt() {
  if (cachedJwt && Date.now() < cachedJwtExpiry) {
    return cachedJwt;
  }

  if (!cachedPrivateKey) {
    cachedPrivateKey = fs.readFileSync(path.resolve(config.nexmo.privateKeyPath));
  }

  const claims = {
    application_id: config.nexmo.applicationId,
    iat: Math.floor(Date.now() / 1000),
    jti: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  };

  cachedJwt = jwt.sign(claims, cachedPrivateKey, { algorithm: "RS256", expiresIn: "1h" });
  cachedJwtExpiry = Date.now() + 55 * 60 * 1000;
  return cachedJwt;
}

module.exports = { getVonageJwt };
