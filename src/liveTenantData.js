import { getTenantSnapshot } from './entraAuth.js';

const fmt = (n) => Number(n || 0).toLocaleString();

function setText(el, value) {
  if (el) el.textContent = value;
}

function updateDashboard(snapshot) {
  const kpis = [...document.querySelectorAll('.kpi-value')];
  [snapshot.users, snapshot.applications, snapshot.devices, snapshot.signIns7d, snapshot.riskySignIns7d]
    .forEach((value, i) => setText(kpis[i], fmt(value)));

  const live = document.querySelector('.live-row');
  if (live) {
    const strong = live.querySelector('strong');
    setText(strong, 'Connected tenant');
    live.querySelector('.separator')?.insertAdjacentText('afterend', ` Live Graph data`);
  }

  const buckets = snapshot.appActivity || { active30: 0, inactive31to90: 0, inactive91to180: 0, inactive180: 0 };
  const totalActivity = buckets.active30 + buckets.inactive31to90 + buckets.inactive91to180 + buckets.inactive180;
  const donut = document.querySelector('.usage .donut-hole strong');
  setText(donut, fmt(snapshot.applications));

  const legend = [...document.querySelectorAll('.usage .legend > div')];
  const values = [buckets.active30, buckets.inactive31to90, buckets.inactive91to180, buckets.inactive180];
  const labels = ['Active (Used in 30 Days)', 'Inactive (31–90 Days)', 'Inactive (91–180 Days)', 'Inactive (>180 Days)'];
  legend.forEach((row, i) => {
    const b = row.querySelector('b');
    const pct = totalActivity ? ((values[i] / totalActivity) * 100).toFixed(1) : '0.0';
    if (b) b.innerHTML = `${fmt(values[i])} <small>(${pct}%)</small>`;
    const textNode = [...row.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim());
    if (textNode) textNode.nodeValue = `${labels[i]} `;
  });

  const inactive90 = buckets.inactive91to180 + buckets.inactive180;
  const attentionItems = [...document.querySelectorAll('.attention-item')];
  if (attentionItems[1]) {
    const value = attentionItems[1].querySelector('b');
    setText(value, fmt(inactive90));
    const detail = attentionItems[1].querySelector('.attention-copy span');
    setText(detail, 'No observed application sign-in activity in 90+ days');
  }

  const aiItems = [...document.querySelectorAll('.ai-item')];
  if (aiItems[0]) {
    const spans = aiItems[0].querySelectorAll('.ai-copy span');
    setText(spans[0], `${fmt(inactive90)} applications have no observed sign-in activity in 90+ days.`);
    if (spans[1]) setText(spans[1], 'Review before disable/archive');
  }

  const rows = [...document.querySelectorAll('.activity-card tbody tr')];
  const signs = snapshot.recentSignIns || [];
  rows.forEach((row, i) => {
    const sign = signs[i];
    if (!sign) return;
    const cells = row.querySelectorAll('td');
    const time = new Date(sign.createdDateTime);
    setText(cells[0], time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    setText(cells[1], sign.isInteractive ? 'Interactive Sign-in' : 'Non-interactive Sign-in');
    setText(cells[2], sign.userDisplayName || sign.userPrincipalName || sign.appDisplayName || 'Service principal');
    setText(cells[3], sign.appDisplayName || sign.resourceDisplayName || 'Microsoft Entra');
    const success = sign.status?.errorCode === 0;
    setText(cells[4], success ? 'Success' : 'Failed');
    setText(cells[5], sign.riskLevelAggregated || 'None');
    cells[4]?.classList.toggle('failed', !success);
    cells[4]?.classList.toggle('success', success);
  });

  const sourceItems = [...document.querySelectorAll('.sources > div')];
  sourceItems.forEach((item, i) => {
    const small = item.querySelector('small');
    setText(small, i === 0 ? 'Connected • Live' : 'Not connected');
  });

  document.dispatchEvent(new CustomEvent('iam-live-data', { detail: snapshot }));
}

export async function syncLiveTenantData() {
  const snapshot = await getTenantSnapshot();
  updateDashboard(snapshot);
  return snapshot;
}
