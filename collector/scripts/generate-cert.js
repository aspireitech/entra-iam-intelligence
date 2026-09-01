#!/usr/bin/env node
// Generates a self-signed certificate for the collector's app-only Graph auth,
// using pure JavaScript (the `selfsigned` package, built on node-forge) instead
// of shelling out to openssl. Works identically on Windows/macOS/Linux with
// nothing but Node itself - no openssl install, no Visual Studio build tools.
import fs from 'node:fs';
import path from 'node:path';
import selfsigned from 'selfsigned';

const CERTS_DIR = path.join(import.meta.dirname, '..', 'certs');
const days = Number(process.argv[2]) || 730;
const subject = process.argv[3] || 'IAM Intelligence Collector';

const certPath = path.join(CERTS_DIR, 'collector.pem');
const keyPath = path.join(CERTS_DIR, 'collector.key');

if (fs.existsSync(certPath)) {
  console.error(`Certificate already exists at ${certPath} - not overwriting.`);
  console.error('Delete both certs/collector.pem and certs/collector.key first if you want to regenerate (this invalidates the old one - you would need to re-upload and re-consent).');
  process.exit(1);
}

const pems = await selfsigned.generate([{ name: 'commonName', value: subject }], {
  keySize: 2048,
  days,
  algorithm: 'sha256',
});

fs.mkdirSync(CERTS_DIR, { recursive: true });
fs.writeFileSync(certPath, pems.cert);
fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });

console.log(`Generated certificate: ${certPath}`);
console.log(`Generated private key: ${keyPath} (kept local, never upload this one)`);
console.log(`Valid for ${days} days.`);
console.log('');
console.log('Next: upload certs/collector.pem (the PUBLIC key) to the Entra app registration\'s');
console.log('Certificates & secrets blade, then grant admin consent - see collector/README.md.');
