import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadConfig() {
  const defaultPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tenants.json');
  const configPath = process.env.IAM_COLLECTOR_CONFIG || defaultPath;
  if (!fs.existsSync(configPath)) {
    throw new Error(`Collector config not found at ${configPath}. Copy tenants.example.json to tenants.json and fill it in - see collector/README.md.`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!raw.clientId) throw new Error('tenants.json is missing "clientId"');
  if (!raw.certPath || !raw.certKeyPath) throw new Error('tenants.json is missing "certPath"/"certKeyPath"');
  if (!Array.isArray(raw.tenants) || !raw.tenants.length) throw new Error('tenants.json must list at least one tenant under "tenants"');
  if (!raw.collectorToken) console.warn('[collector] WARNING: no collectorToken set in tenants.json - the local API is unauthenticated. Set one before exposing this beyond localhost.');
  return raw;
}
