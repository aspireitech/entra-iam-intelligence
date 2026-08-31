import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const attention = [
  { level: 'critical', title: 'Password Expired Users', detail: 'Users with expired passwords', value: 128, action: 'Review users' },
  { level: 'warning', title: 'Inactive Applications > 90 Days', detail: 'No sign-ins in 90 days', value: 46, action: 'Review applications' },
  { level: 'warning', title: 'Users Without MFA', detail: 'High-risk users', value: 214, action: 'Review MFA gaps' },
  { level: 'info', title: 'Orphaned Accounts', detail: 'No owner or manager', value: 36, action: 'Review accounts' },
  { level: 'critical', title: 'Over-Privileged Users', detail: 'Admin roles with high access', value: 18, action: 'Start review' },
];

const activities = [
  ['10:24 AM', 'User Login', 'John.Doe@contoso.com', 'Microsoft 365', 'Success', 'Low'],
  ['09:18 AM', 'Application Provisioned', 'Admin@contoso.com', 'New Salesforce App', 'Success', 'Medium'],
  ['08:45 AM', 'Password Reset', 'Sarah.Wilson@contoso.com', 'Self Service', 'Success', 'Low'],
  ['08:12 AM', 'Failed Sign-in', 'Unknown IP', 'Alex.Miller@contoso.com', 'Failed', 'High'],
  ['07:58 AM', 'Role Assigned', 'Admin@contoso.com', 'Global Admin Role', 'Success', 'High'],
];

const nav = [
  ['Overview', '⌂'], ['Users', '♙'], ['Groups', '♧'], ['Applications', '▦'], ['Devices', '▱'], ['Identities', '◉'],
  ['__Protection', ''], ['Risk Overview', '◈'], ['Sign-ins', '↪'], ['Access Reviews', '▣'], ['Conditional Access', '◌'],
  ['__Operations', ''], ['Provisioning', '⇄'], ['Audit Logs', '≡'], ['Alerts', '♢'], ['Workflows', '◇'],
  ['__Reports', ''], ['Reports', '▤'], ['Data Explorer', '⌕'], ['__Admin', ''], ['Settings', '⚙'], ['Data Sources', '◈'],
];

function Icon({ children }) { return <span className="nav-icon">{children}</span>; }
function Donut({ segments, total, label }) {
  const gradient = `conic-gradient(#31b75a 0 53.2%, #f1a21a 53.2% 77.6%, #e86c32 77.6% 91.4%, #e85555 91.4% 100%)`;
  return <div className="donut" style={{ background: gradient }}><div className="donut-hole"><strong>{total}</strong><span>{label}</span></div></div>;
}
function Sparkline() {
  const pts = '8,74 36,62 64,64 92,55 120,58 148,48 176,60 204,68 232,57 260,70 288,65 316,74 344,55 372,60 400,48';
  return <svg className="spark" viewBox="0 0 408 92" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5"/><line x1="0" y1="88" x2="408" y2="88" stroke="rgba(255,255,255,.07)"/><line x1="0" y1="44" x2="408" y2="44" stroke="rgba(255,255,255,.05)"/></svg>;
}

function App() {
  const [active, setActive] = useState('Overview');
  const [days, setDays] = useState('7 Days');
  const [showBuilder, setShowBuilder] = useState(false);
  const [selectedAttention, setSelectedAttention] = useState(null);
  const [lastSync, setLastSync] = useState('38 sec ago');
  const [toast, setToast] = useState('');

  const navItems = useMemo(() => nav.filter(x => !x[0].startsWith('__')), []);
  const refresh = () => { setLastSync('just now'); setToast('Dashboard refreshed'); setTimeout(() => setToast(''), 2200); };
  const action = (text) => { setToast(`${text} opened`); setTimeout(() => setToast(''), 2200); };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><span>◆</span></div>
        <div><div className="brand-name">Entra IAM Intelligence</div><div className="brand-tag">Identity. Secure. Simplified.</div></div>
      </div>
      <nav>{nav.map(([label, glyph], i) => label.startsWith('__') ? <div className="section-label" key={label}>{label.replace('__','')}</div> : <button key={label} className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => setActive(label)}><Icon>{glyph}</Icon><span>{label}</span></button>)}</nav>
      <div className="sidebar-footer">Powered by<br/><strong>IAM Intelligence Platform</strong></div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="page-title"><span>{active === 'Overview' ? 'Executive Overview' : active}</span><span className="chevron">⌄</span></div>
        <div className="top-actions">
          <button className="range" onClick={() => setDays(days === '7 Days' ? '30 Days' : days === '30 Days' ? '90 Days' : '7 Days')}>{days} <span>({days === '7 Days' ? 'May 18 – May 24, 2025' : days === '30 Days' ? 'Apr 25 – May 24, 2025' : 'Feb 24 – May 24, 2025'})</span>⌄</button>
          <button className="icon-btn" onClick={refresh}>↻</button><button className="icon-btn">⚙</button><button className="filter-btn">⌁ &nbsp; Filters</button>
        </div>
      </header>

      <div className="content">
        <div className="live-row"><span className="live-dot"></span> Tenant: <strong>Contoso</strong><span className="separator">•</span> Synced {lastSync}</div>

        <section className="kpis">
          {[
            ['Total Users','24,583','↑ 3.2%','from last 7 days','users'],['Total Applications','812','↑ 5.4%','from last 7 days','apps'],['Active Devices','18,392','↑ 2.1%','from last 7 days','devices'],['Sign-ins (7D)','56,832','↑ 12.6%','from last 7 days','signin'],['Risky Sign-ins','232','↓ -8.7%','from last 7 days','risk']
          ].map(([title,value,change,sub,type]) => <div className={`kpi ${type}`} key={title}><div className="kpi-icon">{type==='risk'?'♜':type==='signin'?'↪':type==='devices'?'▱':type==='apps'?'▦':'♙'}</div><div><div className="kpi-title">{title}</div><div className="kpi-value">{value}</div><div className="kpi-change">{change} <span>{sub}</span></div></div></div>)}
        </section>

        <section className="grid top-grid">
          <Card title="Application Usage Overview" className="usage">
            <div className="usage-body"><Donut total="812" label="Total Apps"/><div className="legend"><div><i className="green"/>Active (Used in 30 Days)<b>432 <small>(53.2%)</small></b></div><div><i className="amber"/>Inactive (31–90 Days)<b>198 <small>(24.4%)</small></b></div><div><i className="orange"/>Inactive (91–180 Days)<b>112 <small>(13.8%)</small></b></div><div><i className="red"/>Inactive (&gt;180 Days)<b>70 <small>(8.6%)</small></b></div></div></div>
            <button className="card-link" onClick={() => action('All applications')}>View all applications →</button>
          </Card>

          <Card title="Applications Not Used" tabs={['30 Days','90 Days','180 Days']}><div className="bar-chart">{[['Microsoft 365',48],['Salesforce',32],['Zoom',28],['ServiceNow',18],['Workday',15]].map(([name,val],i)=><div className="bar-col" key={name}><div className="bar-value">{val}</div><div className={`bar b${i}`} style={{height:`${val*2.2}px`}}></div><span>{name}</span></div>)}</div><button className="card-link" onClick={() => action('Inactive applications')}>View all inactive applications →</button></Card>

          <Card title="Need Attention (12)" actionLabel="View all" onAction={() => action('All attention items')} className="attention-card">
            {attention.map((item) => <button className="attention-item" key={item.title} onClick={() => setSelectedAttention(item)}><div className={`attention-icon ${item.level}`}>{item.level === 'critical' ? '♜' : item.level === 'warning' ? '▣' : '♙'}</div><div className="attention-copy"><strong>{item.title}</strong><span>{item.detail}</span></div><b className={item.level}>{item.value}</b></button>)}
          </Card>
        </section>

        <section className="grid lower-grid">
          <Card title="User Risk Overview"><div className="risk-body"><Donut total="24,583" label="Total Users"/><div className="risk-legend"><div><i className="green"/>Low Risk <b>22,456 <small>(91.4%)</small></b></div><div><i className="amber"/>Medium Risk <b>1,532 <small>(6.2%)</small></b></div><div><i className="red"/>High Risk <b>595 <small>(2.4%)</small></b></div></div></div><button className="card-link" onClick={() => action('Risk users')}>View risk users →</button></Card>
          <Card title="Sign-in Overview" tabs={['7 Days','30 Days','90 Days']}><div className="chart-head"><span>30K</span><span>20K</span><span>10K</span><span>0</span></div><Sparkline/><div className="chart-labels"><span>May 18</span><span>May 19</span><span>May 20</span><span>May 21</span><span>May 22</span><span>May 23</span><span>May 24</span></div><div className="series"><span><i className="green"/>Successful</span><span><i className="red"/>Failed</span><span><i className="blue"/>MFA</span></div></Card>
          <Card title="Identity Health Score"><div className="score"><div className="gauge"><div className="gauge-fill"></div><div className="gauge-center"><strong>87</strong><span>/100</span></div></div><b>Good</b><small>↑ 6 points from last 7 days</small></div></Card>
          <Card title={<><span>AI Recommendations</span><em className="beta">BETA</em></>} className="ai-card">
            {[['Potential App Cleanup','46 applications have not been used in 90+ days.','$12,450/year','Review Applications','green'],['Password Hygiene','128 users have expired passwords.','', 'Reset Campaign','amber'],['MFA Adoption','214 users are not using MFA.','', 'Enable MFA','blue'],['Access Review','18 users have excessive admin privileges.','', 'Start Review','purple']].map(([t,d,meta,btn,c])=><div className="ai-item" key={t}><div className={`ai-icon ${c}`}>✦</div><div className="ai-copy"><strong>{t}</strong><span>{d}</span>{meta && <span>{meta}</span>}</div><button onClick={() => action(btn)}>{btn}</button></div>)}
          </Card>
        </section>

        <section className="bottom-grid">
          <Card title="Recent Activity" actionLabel="View all" onAction={() => action('Recent activity')} className="activity-card"><table><thead><tr><th>Time</th><th>Activity</th><th>Actor</th><th>Target</th><th>Status</th><th>Risk</th></tr></thead><tbody>{activities.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j} className={j===4 ? (v==='Failed'?'failed':'success') : j===5 ? v.toLowerCase() : ''}>{v}</td>)}</tr>)}</tbody></table></Card>
          <Card title="Data Sources" className="sources-card"><div className="sources">{['◆ Microsoft Entra ID','▣ Microsoft 365','◇ Azure AD Connect','◉ ServiceNow','› Splunk'].map((x,i)=><div key={x}><span>{x}</span><small>Connected</small></div>)}</div><button className="custom-dash" onClick={() => setShowBuilder(true)}>＋ Build custom dashboard</button></Card>
        </section>
      </div>
    </main>

    {selectedAttention && <div className="modal-backdrop" onClick={() => setSelectedAttention(null)}><div className="detail-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSelectedAttention(null)}>×</button><div className={`modal-severity ${selectedAttention.level}`}>{selectedAttention.level.toUpperCase()}</div><h2>{selectedAttention.title}</h2><p>{selectedAttention.detail}. <strong>{selectedAttention.value}</strong> items currently match this signal.</p><div className="evidence"><h4>AI assessment</h4><p>Prioritize review using recent activity, ownership, privilege level and historical baseline. This is a recommendation for human review—not an automatic destructive action.</p></div><div className="modal-actions"><button onClick={() => action('Investigation')}>Investigate</button><button className="primary" onClick={() => action(selectedAttention.action)}>{selectedAttention.action}</button></div></div></div>}

    {showBuilder && <div className="modal-backdrop" onClick={() => setShowBuilder(false)}><div className="builder" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setShowBuilder(false)}>×</button><div className="builder-kicker">CUSTOM DASHBOARD</div><h2>Build your identity view</h2><p className="muted">Start from a template or create a panel from your connected data.</p><div className="templates">{['Executive Identity Pulse','Application Governance','Privileged Identity','Authentication Health','Provisioning Health','Identity Hygiene'].map(x=><button key={x} onClick={() => action(`${x} template`)}>{x}<span>→</span></button>)}</div><div className="builder-divider"><span>or build a panel</span></div><div className="builder-form"><label>Data source<select><option>Microsoft Entra ID</option></select></label><label>Entity<select><option>Applications</option><option>Users</option><option>Service Principals</option></select></label><label>Signal<select><option>Last sign-in</option><option>Role assignment</option><option>Credential expiration</option></select></label><label>Condition<select><option>More than 90 days</option><option>More than 180 days</option><option>Unusual vs baseline</option></select></label></div><button className="primary full" onClick={() => {setShowBuilder(false); setToast('Custom panel added'); setTimeout(() => setToast(''), 2200)}}>Preview & add panel</button></div></div>}
    {toast && <div className="toast">✓ {toast}</div>}
  </div>;
}
function Card({ title, children, tabs, actionLabel, onAction, className='' }) { return <div className={`card ${className}`}><div className="card-header"><h3>{title}</h3>{tabs && <div className="tabs">{tabs.map((t,i)=><button key={t} className={i===0?'selected':''}>{t}</button>)}</div>}{actionLabel && <button className="header-action" onClick={onAction}>{actionLabel}</button>}</div>{children}</div> }

createRoot(document.getElementById('root')).render(<App />);
