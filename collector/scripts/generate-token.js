#!/usr/bin/env node
// Generates a cryptographically random collectorToken - the long random string
// that gates the collector's local HTTP API via the X-IAM-Collector-Token header
// (see collector/src/server.js). Typing this by hand (or leaving the
// tenants.example.json placeholder in place) is the single most common setup
// mistake: either it's too weak/guessable, or it silently doesn't match
// VITE_COLLECTOR_TOKEN in the dashboard's .env, and every collector request then
// fails with 401 Unauthorized - which looks like "the collector is down" in the
// dashboard, not like a token problem.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TENANTS_JSON = path.join(import.meta.dirname, '..', 'tenants.json');
const token = crypto.randomBytes(32).toString('base64url'); // 43 url-safe chars, ~256 bits

if (!fs.existsSync(TENANTS_JSON)) {
  console.log('No collector/tenants.json yet - copy tenants.example.json to tenants.json first, then re-run this script to have it written in automatically. For now, here is a random token you can paste into "collectorToken" by hand:');
  console.log('');
  console.log(token);
  process.exit(0);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(TENANTS_JSON, 'utf8'));
} catch (error) {
  console.error(`tenants.json is not valid JSON: ${error.message}`);
  console.error('Fix the JSON syntax first (a trailing comma is the usual cause), then re-run this script.');
  process.exit(1);
}

const previous = config.collectorToken;
config.collectorToken = token;
fs.writeFileSync(TENANTS_JSON, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Wrote a new collectorToken into ${TENANTS_JSON}:`);
console.log('');
console.log(token);
console.log('');
console.log('Next: set the SAME value as VITE_COLLECTOR_TOKEN in the dashboard SPA\'s .env.local (or .env.production for a real deployment), then restart both the collector and the SPA - Vite only reads .env files at startup, so an already-running `npm run dev` will not pick this up until restarted.');
if (previous && previous !== 'REPLACE-WITH-A-LONG-RANDOM-TOKEN') {
  console.log('');
  console.log(`This replaced an existing token (started with "${previous.slice(0, 6)}..."). Anything still configured with the old token will get 401 Unauthorized from the collector until it's updated too.`);
}
