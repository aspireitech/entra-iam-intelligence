import { listAllReportSchedules, markReportScheduleSent } from './db.js';
import { generateReportCsv } from './reports.js';
import { sendReportEmail, mailerConfigured } from './mailer.js';

function isDue(schedule, now) {
  if (!schedule.lastSentAt) return true;
  const last = new Date(schedule.lastSentAt).getTime();
  const intervalMs = (schedule.frequency === 'weekly' ? 7 : 1) * 86400000;
  return now - last >= intervalMs;
}

// Checks every 15 minutes, not once a day - a daily/weekly schedule doesn't need
// finer granularity than that, but checking only once a day would mean a
// schedule created shortly after that day's check silently waits ~24h for its
// first email instead of going out same-day once it's actually due.
export function startReportScheduler(config) {
  const run = async () => {
    if (!mailerConfigured(config)) return; // no smtp block in tenants.json - nothing to do, not an error
    const now = Date.now();
    for (const schedule of listAllReportSchedules()) {
      if (!isDue(schedule, now)) continue;
      try {
        const { label, csv, collectedAt } = generateReportCsv(schedule.tenantId, schedule.reportId);
        await sendReportEmail(config, {
          to: schedule.recipients.split(',').map((s) => s.trim()).filter(Boolean),
          subject: `IAM Intelligence report: ${label}`,
          text: `Attached: ${label}, generated from the tenant snapshot collected at ${collectedAt}.\n\nThis is an automated ${schedule.frequency} report from the IAM Intelligence collector.`,
          attachmentName: `${schedule.reportId}.csv`,
          attachmentContent: csv,
        });
        markReportScheduleSent(schedule.id, new Date().toISOString());
        console.log(`[collector] Emailed scheduled report "${label}" (tenant ${schedule.tenantId}) to ${schedule.recipients}`);
      } catch (error) {
        console.error(`[collector] Scheduled report ${schedule.id} (tenant ${schedule.tenantId}) failed:`, error.message);
      }
    }
  };
  run();
  const intervalMs = 15 * 60 * 1000;
  return setInterval(run, intervalMs);
}
