import { loadConfig } from './src/config.js';
import { startScheduler } from './src/scheduler.js';
import { startServer } from './src/server.js';

const config = loadConfig();
console.log(`[collector] IAM Intelligence Collector starting for ${config.tenants.length} tenant(s): ${config.tenants.map((t) => t.displayName || t.id).join(', ')}`);
startServer(config);
startScheduler(config);
