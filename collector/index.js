import { loadConfig } from './src/config.js';
import { startScheduler } from './src/scheduler.js';
import { startServer } from './src/server.js';
import { startReportScheduler } from './src/reportScheduler.js';
import { mailerConfigured } from './src/mailer.js';

// Node prints "ExperimentalWarning: SQLite is an experimental feature..." on
// startup - that's Node's own built-in module (node:sqlite), not a bug and not
// something this code can cleanly suppress (Node has no per-warning-type opt-out;
// --no-warnings would hide real deprecation warnings too). Expected, harmless.
console.log('[collector] Note: the "ExperimentalWarning: SQLite..." message above (if shown) is from Node itself and is expected - it does not indicate a problem.');

const config = loadConfig();
console.log(`[collector] IAM Intelligence Collector starting for ${config.tenants.length} tenant(s): ${config.tenants.map((t) => t.displayName || t.id).join(', ')}`);
console.log(mailerConfigured(config) ? '[collector] Email reports: SMTP configured - scheduled/on-demand report emails are enabled.' : '[collector] Email reports: no "smtp" block in tenants.json - report scheduling is stored but emails will not send. See collector/README.md "Email reports".');
startServer(config);
startScheduler(config);
startReportScheduler(config);
