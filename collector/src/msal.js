import fs from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';

const clientCache = new Map();

export function certExpiry(certPath) {
  const pem = fs.readFileSync(certPath, 'utf8');
  const cert = new X509Certificate(pem);
  const expiresAt = new Date(cert.validTo);
  const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 86400000);
  return { expiresAt: expiresAt.toISOString(), daysRemaining, subject: cert.subject };
}

function resolveCredentials(tenant, config) {
  const clientId = tenant.clientId || config.clientId;
  const certPath = tenant.certPath || config.certPath;
  const certKeyPath = tenant.certKeyPath || config.certKeyPath;
  if (!clientId || !certPath || !certKeyPath) {
    throw new Error(`Tenant ${tenant.id} is missing clientId/certPath/certKeyPath (set at tenant level or as top-level defaults in tenants.json)`);
  }
  return { clientId, certPath, certKeyPath };
}

function getMsalClient(tenant, config) {
  if (clientCache.has(tenant.id)) return clientCache.get(tenant.id);
  const { clientId, certPath, certKeyPath } = resolveCredentials(tenant, config);
  const certPem = fs.readFileSync(certPath, 'utf8');
  const privateKey = fs.readFileSync(certKeyPath, 'utf8');
  const cert = new X509Certificate(certPem);
  // Azure AD's certificate credential expects the SHA-1 thumbprint as hex with no separators.
  const thumbprint = cert.fingerprint.replace(/:/g, '');
  const app = new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenant.id}`,
      clientCertificate: { thumbprint, privateKey },
    },
  });
  clientCache.set(tenant.id, app);
  return app;
}

export async function getAppToken(tenant, config) {
  const app = getMsalClient(tenant, config);
  const result = await app.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  if (!result?.accessToken) throw new Error(`No app-only token returned for tenant ${tenant.id}`);
  return result.accessToken;
}
