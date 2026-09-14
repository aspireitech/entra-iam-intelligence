<?php
declare(strict_types=1);
// Static marketing copy - PHP is only load-bearing for submit-lead.php and
// admin.php. Kept as .php (not .html) for consistency with the rest of this
// site and so a small dynamic touch (e.g. a real lead count once there's
// enough volume to be worth showing) can be added later without renaming
// anything or changing the deployed URL.
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IAM Intelligence — Identity Security Visibility for Microsoft Entra ID</title>
<meta name="description" content="See every identity risk in your Microsoft Entra tenant - privileged access, MFA gaps, stale accounts, ownerless apps and non-human identities - without building and maintaining your own KQL queries.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#071321; --panel:#0b1c30; --panel2:#0e2238; --border:rgba(160,193,226,.14);
    --text:#edf5ff; --muted:#9fb2c8; --muted2:#71849a;
    --accent1:#276fd3; --accent2:#245db4; --accent-soft:rgba(60,132,211,.12);
    --good:#3ecf8e; --warn:#e7b549;
    --font-display:'Space Grotesk',Inter,system-ui,sans-serif;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
  a{color:inherit}
  .wrap{max-width:1120px;margin:0 auto;padding:0 24px}
  .pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;letter-spacing:.3px;color:#8fc0ff;background:var(--accent-soft);border:1px solid rgba(60,132,211,.3);padding:5px 12px;border-radius:99px}

  header.site{position:sticky;top:0;z-index:20;background:rgba(7,19,33,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
  .nav{display:flex;align-items:center;justify-content:space-between;padding:14px 0}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px}
  .brand-mark{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,var(--accent1),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 6px 16px rgba(23,102,207,.35)}
  .brand small{display:block;color:var(--muted2);font-weight:500;font-size:10.5px;letter-spacing:.3px}
  nav.links{display:flex;gap:26px;font-size:13.5px;color:var(--muted)}
  nav.links a:hover{color:var(--text)}
  /* No hamburger menu on this single page - everything's one scroll away
     regardless - so the simplest correct fix for the header overflowing (nav
     links + CTA button wrapping/clipping) below ~640px is to drop the
     secondary links and keep only the brand and the primary CTA. */
  @media (max-width:640px){
    nav.links{display:none}
    .nav{gap:10px}
    .brand small{display:none}
  }
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;text-decoration:none;padding:11px 20px;transition:transform .1s ease,box-shadow .15s ease}
  .btn-primary{background:linear-gradient(90deg,var(--accent1),var(--accent2));color:#fff;box-shadow:0 8px 22px rgba(23,102,207,.35)}
  .btn-primary:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(23,102,207,.45)}
  .btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
  .btn-ghost:hover{background:rgba(255,255,255,.04)}
  .btn-sm{padding:8px 14px;font-size:13px}

  section{padding:88px 0}
  @media (max-width:720px){section{padding:56px 0}}
  h1{font-family:var(--font-display);font-size:clamp(30px,5vw,50px);font-weight:700;line-height:1.12;margin:18px 0 18px;letter-spacing:-.5px}
  h2{font-family:var(--font-display);font-size:clamp(24px,3.4vw,34px);font-weight:700;margin:0 0 12px;letter-spacing:-.3px}
  .brand{font-family:var(--font-display)}

  /* Scroll-reveal: fade + rise as each block enters view, toggled by the
     IntersectionObserver at the bottom of the page. Skipped entirely for
     anyone with reduced-motion set at the OS level - the content is already
     there either way, this is purely decorative entrance timing. */
  .reveal{opacity:0;transform:translateY(20px);transition:opacity .7s ease,transform .7s ease}
  .reveal.in{opacity:1;transform:none}
  @media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}}
  .kicker{color:#8fc0ff;font-weight:700;font-size:12.5px;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px}
  .lead{color:var(--muted);font-size:17px;max-width:640px}
  .section-head{max-width:680px;margin:0 auto 44px;text-align:center}
  .section-head .lead{margin:0 auto}

  .hero{position:relative;padding-top:76px;text-align:center;overflow:hidden}
  /* Ambient glow behind the headline - purely decorative, sits behind
     everything (z-index:0) with .wrap raised above it so it never
     interferes with clicks/selection. */
  .hero::before{content:'';position:absolute;top:-260px;left:50%;transform:translateX(-50%);width:1000px;height:1000px;max-width:200vw;background:radial-gradient(circle,rgba(39,111,211,.28),transparent 68%);pointer-events:none;z-index:0}
  .hero .wrap{position:relative;z-index:1}
  .hero .lead{margin:0 auto 30px}
  .hero-actions{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-bottom:18px}
  .hero-note{color:var(--muted2);font-size:13px}
  .hero-shot{margin-top:56px;border-radius:16px;border:1px solid var(--border);background:linear-gradient(180deg,var(--panel),var(--panel2));padding:14px;box-shadow:0 30px 80px rgba(0,0,0,.45);text-align:left}

  .carousel-frame{position:relative;border-radius:10px;overflow:hidden;border:1px solid var(--border);background:var(--bg);aspect-ratio:16/9.6}
  @media (max-width:720px){.carousel-frame{aspect-ratio:4/3.6}}
  .carousel-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;opacity:0;transition:opacity 1s ease}
  .carousel-img.active{opacity:1}
  /* Below the frame, not overlaid on it - an overlay badge would sit on top
     of whatever happens to be in that corner of each screenshot (the real
     app's own sidebar/logo among them), which looked like UI clutter
     colliding with UI clutter. A caption underneath never collides with
     anything. */
  .carousel-caption-row{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:14px}
  .carousel-caption{color:#8fc0ff;font-weight:700;font-size:12px;letter-spacing:.5px;text-transform:uppercase}
  .carousel-dots{display:flex;justify-content:center;gap:8px}
  .carousel-dot{width:8px;height:8px;border-radius:50%;background:var(--border);border:0;cursor:pointer;padding:0;transition:background .2s ease,transform .2s ease}
  .carousel-dot.active{background:var(--accent1);transform:scale(1.35)}

  .problem-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
  @media (max-width:900px){.problem-grid{grid-template-columns:repeat(2,1fr)}}
  @media (max-width:520px){.problem-grid{grid-template-columns:1fr}}
  .problem-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:22px}
  .problem-card .ico{font-size:22px;margin-bottom:10px}
  .problem-card h3{font-size:15px;margin:0 0 8px}
  .problem-card p{color:var(--muted);font-size:13.5px;margin:0}

  .roi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:8px}
  @media (max-width:860px){.roi-grid{grid-template-columns:1fr}}
  .roi-card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--border);border-radius:14px;padding:26px}
  .roi-card h3{font-size:17px;margin:0 0 10px}
  .roi-card p{color:var(--muted);font-size:14px;margin:0}
  .roi-card .num{font-size:13px;color:#8fc0ff;font-weight:700;letter-spacing:.4px;margin-bottom:10px;text-transform:uppercase}

  .vs{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:28px;margin-top:44px;display:grid;grid-template-columns:1fr 1fr;gap:0}
  @media (max-width:720px){.vs{grid-template-columns:1fr}}
  .vs-col{padding:18px 24px}
  .vs-col:first-child{border-right:1px solid var(--border)}
  @media (max-width:720px){.vs-col:first-child{border-right:0;border-bottom:1px solid var(--border)}}
  .vs-col h4{margin:0 0 12px;font-size:14px;color:var(--muted2);text-transform:uppercase;letter-spacing:.5px}
  .vs-col ul{margin:0;padding:0;list-style:none}
  .vs-col li{font-size:14px;color:var(--muted);padding:7px 0;display:flex;gap:10px}
  .vs-col.good li{color:var(--text)}

  .features-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}
  @media (max-width:960px){.features-grid{grid-template-columns:repeat(2,1fr)}}
  @media (max-width:560px){.features-grid{grid-template-columns:1fr}}
  .feature-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:20px}
  .feature-card .tag{font-size:11px;color:#8fc0ff;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
  .feature-card h3{font-size:15px;margin:0 0 8px}
  .feature-card ul{margin:0;padding-left:16px;color:var(--muted);font-size:13px}
  .feature-card li{margin-bottom:4px}

  .trust{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:36px}
  .trust-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:24px}
  @media (max-width:860px){.trust-grid{grid-template-columns:repeat(2,1fr)}}
  .trust-item h4{font-size:14px;margin:0 0 6px;display:flex;align-items:center;gap:8px}
  .trust-item p{color:var(--muted);font-size:13px;margin:0}

  #demo{background:linear-gradient(180deg,var(--panel),var(--panel2));border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
  .demo-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:48px;align-items:start}
  @media (max-width:860px){.demo-grid{grid-template-columns:1fr}}
  .demo-points{margin-top:26px}
  .demo-point{display:flex;gap:12px;margin-bottom:16px}
  .demo-point .dot{width:22px;height:22px;border-radius:6px;background:var(--accent-soft);color:#8fc0ff;display:flex;align-items:center;justify-content:center;font-size:12px;flex:none;margin-top:2px}
  .demo-point p{margin:0;color:var(--muted);font-size:14px}
  form#lead-form{background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:26px}
  .field{margin-bottom:14px}
  .field label{display:block;font-size:12.5px;color:var(--muted2);margin-bottom:6px;font-weight:600}
  .field input,.field select,.field textarea{width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:11px 12px;font-size:14px;font-family:inherit}
  .field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--accent1)}
  .field-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media (max-width:480px){.field-row{grid-template-columns:1fr}}
  .hp{position:absolute;left:-9999px;top:-9999px}
  .form-msg{font-size:13.5px;margin-top:10px;display:none}
  .form-msg.err{color:#ff9b9b}
  .form-msg.ok{color:var(--good)}
  .form-foot{color:var(--muted2);font-size:12px;margin-top:12px}
  #lead-form button[type=submit]{width:100%;margin-top:4px}
  #lead-form button[disabled]{opacity:.6;cursor:default}

  footer{border-top:1px solid var(--border);padding:36px 0;color:var(--muted2);font-size:13px}
  .footer-row{display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px}
  footer a{color:var(--muted);text-decoration:none}
  footer a:hover{color:var(--text)}
</style>
</head>
<body>

<header class="site">
  <div class="wrap nav">
    <div class="brand">
      <div class="brand-mark">◆</div>
      <div>IAM Intelligence<small>by Aspire iTECH Solutions</small></div>
    </div>
    <nav class="links">
      <a href="#why">Why it matters</a>
      <a href="#features">Features</a>
      <a href="#trust">Security model</a>
    </nav>
    <a class="btn btn-primary btn-sm" href="#demo">Get free demo access</a>
  </div>
</header>

<section class="hero">
  <div class="wrap">
    <span class="pill">◆ Built for Microsoft Entra ID</span>
    <h1>See every identity risk in your&nbsp;Entra tenant<br>— before an auditor, attacker, or&nbsp;customer&nbsp;does.</h1>
    <p class="lead">IAM Intelligence turns Microsoft Graph identity data into continuous, correlated posture visibility — privileged access, MFA gaps, stale accounts, ownerless apps and non-human identity risk — without you building or maintaining a single KQL query.</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="#demo">Get free demo access</a>
      <a class="btn btn-ghost" href="#why">Why not just query my data lake?</a>
    </div>
    <div class="hero-note">No credit card. No Microsoft sign-in required to view the demo.</div>

    <div class="hero-shot reveal">
      <!-- Real screenshots of the actual demo dashboard (demo mode uses
           fabricated sample data - see src/demoData.js in the main repo -
           never a real customer's tenant), not mockups. Auto-rotates through
           five real views so a visitor sees the breadth of the product
           without clicking anything first. -->
      <div class="carousel" id="carousel">
        <div class="carousel-frame">
          <img class="carousel-img active" src="assets/screenshots/overview.webp" alt="IAM Intelligence dashboard — Executive Overview">
          <img class="carousel-img" src="assets/screenshots/identity-risk.webp" alt="IAM Intelligence dashboard — Toxic Combinations, Identity Risk">
          <img class="carousel-img" src="assets/screenshots/governance.webp" alt="IAM Intelligence dashboard — Risk Register, Governance">
          <img class="carousel-img" src="assets/screenshots/azure.webp" alt="IAM Intelligence dashboard — Azure Subscriptions">
          <img class="carousel-img" src="assets/screenshots/admin.webp" alt="IAM Intelligence dashboard — Reports, Admin">
        </div>
        <div class="carousel-caption-row">
          <span class="carousel-caption" id="carousel-caption">Overview</span>
          <div class="carousel-dots" id="carousel-dots"></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section id="why">
  <div class="wrap">
    <div class="section-head reveal">
      <div class="kicker">The problem</div>
      <h2>If you can't see it, you can't secure it</h2>
      <p class="lead">Most organizations under ~3,000 employees have no SIEM, no data lake, and no one whose job is writing Entra queries. The alternative to a posture tool like this usually isn't "a nicer dashboard" — it's nothing.</p>
    </div>
    <div class="problem-grid reveal">
      <div class="problem-card"><div class="ico">◐</div><h3>Standing privileged access</h3><p>Admins with permanent roles instead of PIM-eligible, time-bound access — and no easy way to see who.</p></div>
      <div class="problem-card"><div class="ico">⚠</div><h3>MFA gaps hiding in plain sight</h3><p>A handful of unprotected accounts is all it takes. Finding them today means exporting a report and cross-referencing by hand.</p></div>
      <div class="problem-card"><div class="ico">⚶</div><h3>Non-human identity blind spots</h3><p>Ownerless apps and credential-bearing service principals with admin rights are one of the fastest-growing, least-monitored risk categories.</p></div>
      <div class="problem-card"><div class="ico">◫</div><h3>Nothing ready for an audit</h3><p>SOC 2, ISO 27001 and cyber-insurance questionnaires ask for exactly this evidence — access reviews, MFA coverage, credential expiry — and today that means a manual scramble.</p></div>
    </div>
  </div>
</section>

<section id="roi" style="background:var(--panel);border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
  <div class="wrap">
    <div class="section-head reveal">
      <div class="kicker">Why this, not a data lake query</div>
      <h2>You already have the raw logs. That's not the same as posture.</h2>
      <p class="lead">A data lake gives you events. Turning that into "who is privileged AND lacks MFA AND is stale" is correlation logic someone has to write, test, and keep correct as Microsoft's schema changes. That's the part we've already built.</p>
    </div>
    <div class="roi-grid reveal">
      <div class="roi-card">
        <div class="num">Built-in, not build-it-yourself</div>
        <h3>Cross-entity correlation, out of the box</h3>
        <p>Toxic combinations, privileged-but-standing access, ownerless apps holding admin rights — logic that takes real domain expertise to get right, maintained for you instead of re-derived from scratch in KQL.</p>
      </div>
      <div class="roi-card">
        <div class="num">Minutes, not months</div>
        <h3>Time to first useful view</h3>
        <p>A certificate-based, read-only collector against your tenant gets you posture visibility same-day — not after a multi-week Sentinel workbook build-out.</p>
      </div>
      <div class="roi-card">
        <div class="num">Audit-ready</div>
        <h3>Evidence, not just charts</h3>
        <p>Export exactly what a SOC 2 or ISO 27001 review asks for — access reviews, MFA coverage, credential expiry — in seconds instead of days of manual pulling.</p>
      </div>
    </div>

    <div class="vs reveal">
      <div class="vs-col">
        <h4>If you already have</h4>
        <ul>
          <li>→ A SIEM/data lake ingesting Entra logs</li>
          <li>→ A security engineer maintaining identity KQL</li>
          <li>→ Existing Sentinel workbooks for identity posture</li>
        </ul>
      </div>
      <div class="vs-col good">
        <h4>This is built for you if</h4>
        <ul>
          <li>✓ No SIEM or dedicated identity engineer today</li>
          <li>✓ You need audit/compliance evidence on demand</li>
          <li>✓ You want visibility without a multi-week build-out</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section id="features">
  <div class="wrap">
    <div class="section-head reveal">
      <div class="kicker">What's inside</div>
      <h2>One tenant, five lenses</h2>
      <p class="lead">Every view below is a real, shipped part of the dashboard you'll see in the demo — not a roadmap slide.</p>
    </div>
    <div class="features-grid reveal">
      <div class="feature-card">
        <div class="tag">Directory</div>
        <h3>Users, Groups, Devices, Apps</h3>
        <ul><li>Account status &amp; stale accounts</li><li>Guest access</li><li>Device compliance</li><li>App registrations &amp; ownership</li></ul>
      </div>
      <div class="feature-card">
        <div class="tag">Identity Risk</div>
        <h3>Where the exposure is</h3>
        <ul><li>Privileged access &amp; PIM gaps</li><li>Non-human identity risk</li><li>Toxic combinations</li><li>Legacy auth &amp; sign-in trends</li></ul>
      </div>
      <div class="feature-card">
        <div class="tag">Governance</div>
        <h3>Prove it, don't just see it</h3>
        <ul><li>Shared risk register</li><li>App consent review</li><li>License utilization</li></ul>
      </div>
      <div class="feature-card">
        <div class="tag">Azure</div>
        <h3>Beyond Entra</h3>
        <ul><li>Subscription-level RBAC visibility</li><li>Auto-populated, no per-user consent</li></ul>
      </div>
      <div class="feature-card">
        <div class="tag">Admin</div>
        <h3>Keep it running</h3>
        <ul><li>Scheduled report delivery</li><li>Collector health &amp; cert expiry</li><li>Multi-source ready</li></ul>
      </div>
    </div>
  </div>
</section>

<section id="trust">
  <div class="wrap trust reveal">
    <div class="kicker">Security model</div>
    <h2 style="margin-bottom:6px">Least privilege by design</h2>
    <p class="lead">The same principles the dashboard applies to your tenant apply to how it's built.</p>
    <div class="trust-grid">
      <div class="trust-item"><h4>◐ Read-only by default</h4><p>No destructive action runs without explicit human approval.</p></div>
      <div class="trust-item"><h4>⚿ Certificate-based auth</h4><p>App-only Microsoft Graph access via a certificate you generate and control — no client secret.</p></div>
      <div class="trust-item"><h4>⌂ Self-hosted option</h4><p>Run the collector on your own infrastructure — your private key never has to leave your network.</p></div>
      <div class="trust-item"><h4>◈ Built-in throttling protection</h4><p>Bounded, staggered Microsoft Graph calls designed to hold up at enterprise scale, not just in a demo tenant.</p></div>
    </div>
  </div>
</section>

<section id="demo">
  <div class="wrap demo-grid reveal">
    <div>
      <div class="kicker">Try it</div>
      <h2>See it live in about two minutes</h2>
      <p class="lead">Fill in a few details and we'll hand you the live demo dashboard — sample data, every real view, no Microsoft sign-in required.</p>
      <div class="demo-points">
        <div class="demo-point"><div class="dot">1</div><p>Tell us who you are and where you work.</p></div>
        <div class="demo-point"><div class="dot">2</div><p>We open the demo dashboard for you immediately.</p></div>
        <div class="demo-point"><div class="dot">3</div><p>We'll follow up to talk about connecting your real tenant — only if you want to.</p></div>
      </div>
    </div>

    <form id="lead-form" autocomplete="on">
      <div class="field-row">
        <div class="field"><label for="name">Full name</label><input id="name" name="name" required maxlength="120" placeholder="Jordan Lee"></div>
        <div class="field"><label for="email">Work email</label><input id="email" name="email" type="email" required maxlength="190" placeholder="jordan@company.com"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="company">Company</label><input id="company" name="company" required maxlength="160" placeholder="Company name"></div>
        <div class="field">
          <label for="company_size">Company size</label>
          <select id="company_size" name="company_size">
            <option value="">Select…</option>
            <option>1–50</option><option>51–200</option><option>201–1,000</option>
            <option>1,001–5,000</option><option>5,000+</option>
          </select>
        </div>
      </div>
      <div class="field"><label for="phone">Phone (optional)</label><input id="phone" name="phone" maxlength="40" placeholder="Optional"></div>
      <div class="field"><label for="message">What are you hoping to see? (optional)</label><textarea id="message" name="message" rows="2" maxlength="500" placeholder="Optional"></textarea></div>
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off">
      <button type="submit" class="btn btn-primary" id="submit-btn">View live demo →</button>
      <div class="form-msg" id="form-msg"></div>
      <div class="form-foot">We'll only use this to follow up about IAM Intelligence — no spam, no sharing your details.</div>
    </form>
  </div>
</section>

<footer>
  <div class="wrap footer-row">
    <div>© <?php echo date('Y'); ?> Aspire iTECH Solutions. All rights reserved.</div>
    <div><a href="https://aspireitech.net">aspireitech.net</a> &nbsp;·&nbsp; <a href="mailto:hello@aspireitech.net">hello@aspireitech.net</a></div>
  </div>
</footer>

<script>
document.getElementById('lead-form').addEventListener('submit', async function(e){
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  const msg = document.getElementById('form-msg');
  msg.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Please wait…';
  try {
    const res = await fetch('submit-lead.php', { method: 'POST', body: new FormData(this) });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Something went wrong. Please try again.');
    }
    msg.textContent = 'Thanks! Opening your demo…';
    msg.className = 'form-msg ok';
    msg.style.display = 'block';
    setTimeout(function(){ window.location.href = data.demo_url; }, 700);
  } catch (err) {
    msg.textContent = err.message || 'Something went wrong. Please try again.';
    msg.className = 'form-msg err';
    msg.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'View live demo →';
  }
});

// Hero screenshot carousel: auto-advances through real demo-mode screenshots
// with a slow crossfade, dot navigation for manual control, pauses on
// hover/focus, and never auto-advances for anyone with reduced-motion set at
// the OS level (dots still work - only the automatic timer is skipped).
(function(){
  const labels = ['Overview', 'Identity Risk', 'Governance', 'Azure', 'Admin'];
  const imgs = document.querySelectorAll('.carousel-img');
  const caption = document.getElementById('carousel-caption');
  const dotsWrap = document.getElementById('carousel-dots');
  const carouselEl = document.getElementById('carousel');
  if (!imgs.length || !dotsWrap || !carouselEl) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let active = 0;
  let timer = null;

  labels.forEach(function(label, i){
    const dot = document.createElement('button');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dot.type = 'button';
    dot.setAttribute('aria-label', 'Show ' + label);
    dot.addEventListener('click', function(){ show(i); restart(); });
    dotsWrap.appendChild(dot);
  });
  const dots = dotsWrap.querySelectorAll('.carousel-dot');

  function show(i){
    imgs[active].classList.remove('active');
    dots[active].classList.remove('active');
    active = i;
    imgs[active].classList.add('active');
    dots[active].classList.add('active');
    caption.textContent = labels[active];
  }
  function next(){ show((active + 1) % imgs.length); }
  function restart(){
    if (timer) clearInterval(timer);
    timer = reduceMotion ? null : setInterval(next, 4800);
  }
  restart();
  carouselEl.addEventListener('mouseenter', function(){ if (timer) clearInterval(timer); });
  carouselEl.addEventListener('mouseleave', restart);
})();

// Scroll-reveal for major section blocks - see .reveal in <style> above.
(function(){
  const targets = document.querySelectorAll('.reveal');
  if (!targets.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  targets.forEach(function(el){ io.observe(el); });
})();
</script>

</body>
</html>
