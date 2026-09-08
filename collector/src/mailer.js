import nodemailer from 'nodemailer';

// SMTP is optional - only report scheduling/email-on-demand needs it. Everything
// else in the collector (snapshot collection, the read-only HTTP API) works with
// no smtp block in tenants.json at all.
export function mailerConfigured(config) {
  return Boolean(config.smtp && config.smtp.host && config.smtp.user);
}

let cachedTransport = null;
let cachedKey = null;
function getTransport(config) {
  const { host, port, secure, user, pass } = config.smtp;
  const key = `${host}:${port}:${user}`;
  if (cachedTransport && cachedKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host,
    port: port || 587,
    secure: Boolean(secure),
    auth: user ? { user, pass } : undefined,
  });
  cachedKey = key;
  return cachedTransport;
}

export async function sendReportEmail(config, { to, subject, text, attachmentName, attachmentContent }) {
  if (!mailerConfigured(config)) {
    throw new Error('SMTP is not configured in tenants.json - see collector/README.md "Email reports" section.');
  }
  const transport = getTransport(config);
  const from = config.smtp.from || config.smtp.user;
  await transport.sendMail({
    from,
    to: Array.isArray(to) ? to.join(',') : to,
    subject,
    text,
    attachments: attachmentContent ? [{ filename: attachmentName, content: attachmentContent }] : undefined,
  });
}
