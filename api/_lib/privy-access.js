import { importSPKI, jwtVerify } from 'jose';

// Pin the app's public verification key; never trust a JWT-supplied key URL.
export async function verifyPrivyAccessToken(token) {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID;
  const pem = process.env.PRIVY_VERIFICATION_KEY;
  if (!appId || !pem) throw new Error('Privy server verification is not configured');
  const key = await importSPKI(pem.replace(/\\n/g, '\n'), 'ES256');
  const { payload } = await jwtVerify(token, key, {
    algorithms: ['ES256'], issuer: 'privy.io', audience: appId,
    requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 30,
  });
  if (typeof payload.sub !== 'string' || !/^did:privy:[A-Za-z0-9_-]+$/.test(payload.sub)) {
    throw new Error('Invalid Privy subject');
  }
  return payload.sub;
}
