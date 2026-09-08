# IAM Intelligence — Setup Runbook

This is the step-by-step, in-order runbook for standing up IAM Intelligence
from nothing: the dashboard (SPA), the Microsoft Entra app registration, and
(optionally) the always-on collector that powers multi-tenant view, faster
refresh, historical trend, and email reports. Every step says **why** it
exists, gives the exact command, and ends with **Validate** / **Expected
result** so you know it worked before moving to the next step.

Do the steps in order. Later steps (the collector, in particular) assume
earlier ones are already done — skipping ahead is the most common way to end
up debugging a symptom two steps removed from the actual cause.

Two paths through this document:

- **Dashboard only** (most people): steps 1–5. You get the live, single-tenant
  dashboard, signed in with your own Microsoft account, no server to run.
- **Dashboard + collector** (multi-tenant view, faster refresh, historical
  trend, unattended collection, email reports): steps 1–6.

Step 7 (Demo mode) works with **no setup at all** — jump straight there if
you just want to see the product before doing any of this.

---

## 1. Prerequisites

| Requirement | Why |
|---|---|
| Node.js 20+ (dashboard) / 22.5+ (collector, if you use it) | The dashboard build tooling (Vite) needs 20+; the collector uses Node's built-in `node:sqlite`, which needs 22.5+. Two different minimums — the collector will refuse to start on an older Node even if the dashboard runs fine. |
| Git | To clone the repository. |
| A Microsoft Entra ID tenant where you can create an app registration | Global Administrator or Application Administrator role is enough; you don't need Global Admin for everything, but admin consent (step 3.3) does need an administrator. |
| (Collector path only) A machine that can stay running | Your own server, VM, or workstation — not required to be Azure. |

**Validate:**

```bash
node --version
git --version
```

**Expected result:** Node prints `v20.x.x` or higher (or `v22.5.x`+ if you're
also doing the collector), and Git prints a version. If Node is missing,
install the LTS release from https://nodejs.org/en/download/ before
continuing — `scripts/setup.ps1 -InstallNode` can also attempt this for you
on Windows via `winget`.

---

## 2. Clone the repository and install the dashboard

```bash
git clone https://github.com/aspireitech/entra-iam-intelligence.git
cd entra-iam-intelligence
npm install
```

**Why:** `npm install` pulls in React, Vite, and MSAL — everything the
browser app needs. This does **not** install the collector's dependencies;
those live in `collector/` with their own `package.json` and are installed
separately in step 6.

**Validate:**

```bash
ls node_modules/.package-lock.json
```

**Expected result:** The file exists (no "No such file or directory"
error). `npm install` prints "added N packages" with no `npm ERR!` lines.

---

## 3. Register the Entra app (SPA)

This is the one manual step in the Entra admin center you cannot script —
Microsoft requires it be done through the portal or Graph/PowerShell with
your own admin credentials.

### 3.1 Create the app registration

In the [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** →
**App registrations** → **New registration**:

- **Name:** IAM Intelligence (or your own product name)
- **Supported account types:** **Accounts in any organizational directory
  (Any Microsoft Entra ID tenant — Multitenant)**
- **Redirect URI:** Platform = **Single-page application (SPA)**, URI =
  `http://localhost:5173`

Multitenant + `organizations` authority is what lets any work/school account
from any tenant sign in — not just your own. **Do not** create a client
secret or certificate for this registration's SPA platform: the browser app
authenticates with MSAL's authorization-code-with-PKCE flow, which needs
neither, and a secret placed in a browser app can't be kept secret anyway.

### 3.2 Add delegated Microsoft Graph permissions

**API permissions → Add a permission → Microsoft Graph → Delegated
permissions**, add:

| Permission | Purpose |
|---|---|
| `User.Read` | Sign in and identify the current user |
| `User.Read.All` | User inventory, manager relationships |
| `Application.Read.All` | Application/service-principal inventory, credential expiry |
| `Group.Read.All` | Group inventory, type/sync/membership breakdown |
| `Device.Read.All` | Device inventory, compliance state |
| `AuditLog.Read.All` | Sign-in logs, directory audit, MFA registration report |

These six are requested at first connect. Three more are requested only
when their page is opened (progressive consent — see
`docs/PERMISSIONS.md`): `IdentityRiskyUser.Read.All`,
`RoleManagement.Read.Directory`, `Policy.Read.All` for Risk
Overview/Privileged Access/Conditional Access, and `Organization.Read.All`
for Licenses.

### 3.3 Grant admin consent

Still on **API permissions**, click **Grant admin consent for
&lt;your org&gt;**. Most of the permissions above require this — a
non-admin user's own consent isn't enough for tenant-wide read access.

**Validate:** On the API permissions blade, every permission listed should
show a green checkmark under "Status" reading **Granted for &lt;your
org&gt;**.

**Expected result:** No permission shows "Not granted" for the six core
scopes above. (The four progressive-consent scopes can stay ungranted here —
they're requested live, from inside the app, the first time their page is
opened; see step 4's validation.)

### 3.4 Note the client ID

**Overview** blade → copy **Application (client) ID**. You'll need it in
step 4. It is **not** a secret — it's fine to put in a public repo or a
browser-visible env var.

---

## 4. Configure and run the dashboard locally

```bash
cp .env.example .env.local   # if .env.example exists; otherwise create it fresh
```

Edit `.env.local`:

```env
VITE_ENTRA_CLIENT_ID=<the Application (client) ID from step 3.4>
VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/organizations
```

**Why:** Vite only reads `.env*` files at process start — these values get
baked into the built JS, not read at runtime, so **any change to
`.env.local` needs the dev server (or a rebuild) restarted** to take effect.

Then run it:

```bash
npm run dev
```

(Or `./scripts/start.sh` / `.\scripts\start.ps1` from the repo root, which
also validates Node/npm/the build before starting — see step 1.)

**Validate:** Open the URL Vite prints (normally `http://localhost:5173`) in
a browser. Click **Sign in with Microsoft**, complete the Microsoft login
prompt, and approve the consent screen if this is the first sign-in for
this account.

**Expected result:** You land on the **Executive Overview** page with live
KPI tiles (Total Users, Total Groups, Total Applications, Active Devices,
Sign-ins, Risky Sign-ins) showing real numbers from your tenant, not
placeholders. The bottom-left "live-row" strip reads `Live Microsoft Graph •
Auto-refresh every 30s`. If you instead see `Permission required` on a
tile, re-check step 3.2/3.3 for that specific permission — the app never
silently shows a fabricated number in place of a denied one.

---

## 5. Build and deploy the dashboard (production)

```bash
npm run build
```

**Why:** Produces `dist/` — plain static HTML/JS/CSS. There is no
server-side rendering and no client-side router (one route, internal state
switches panels), so **no long-running Node process and no URL-rewrite
config is needed to host it** — any static file server works (IIS, nginx,
S3+CloudFront, Azure Static Web Apps, etc.). Copy `dist/` to the host's
document root.

**Validate:**

```bash
npm run preview
```

**Expected result:** `npm run build` prints `✓ built in <N>ms` with no
errors, and `dist/index.html`, `dist/assets/*.js`, `dist/assets/*.css`
exist. `npm run preview` serves the built output on a local port (e.g.
`http://localhost:4173`) and behaves identically to `npm run dev`. Note:
this is for local verification only — `npm run preview` is a foreground
process, not how you'd run this in production; a real deployment just needs
`dist/` copied to a static host as described above. Rebuild and redeploy
whenever `.env.production` changes — there's no runtime config reload.

---

## 6. (Optional) Set up the collector

Skip this whole section if you only need the single-tenant live dashboard
from step 4 — it already works standalone. Do this section if you want any
of: a combined view across multiple tenants, faster refresh (~8s vs. 30s+),
historical trend/delta, "who registered this app" tracking, or email
reports.

### 6.1 Install collector dependencies

```bash
cd collector
npm install
```

**Why:** The collector is a separate Node project with its own
`package.json` (MSAL for Node, a pure-JS cert generator, and — since email
reports were added — `nodemailer`). It does **not** share dependencies with
the dashboard.

**Validate:** `ls node_modules/.package-lock.json` (same check as step 2).
**Expected result:** File exists, no `npm ERR!` output.

### 6.2 Generate the collector's certificate

```bash
node scripts/generate-cert.js
```

**Why:** The collector authenticates to Graph as an **application** (not a
signed-in user), using a certificate you generate and keep — not a client
secret. The private key never leaves this machine; only the public
certificate goes to Entra. Pure JavaScript, no `openssl` needed, works
identically on Windows/macOS/Linux.

**Validate:**

```bash
ls certs/collector.pem certs/collector.key
```

**Expected result:** Both files exist. The script itself prints "Generated
certificate" / "Generated private key" and "Valid for 730 days." **Never**
commit either file to git — `.gitignore` already excludes `collector/certs/*.key`
and `*.pem`. If you re-run this script and it refuses ("Certificate already
exists"), that's intentional — delete both files first if you really want to
regenerate (this invalidates the old one; you'd need to re-upload and
re-consent).

### 6.3 Upload the certificate and grant application permissions

Back in the Azure Portal, on the **same app registration** from step 3 (or a
separate one if you'd rather keep delegated and application permissions
apart):

1. **Certificates & secrets → Certificates → Upload certificate** → upload
   `collector/certs/collector.pem` (the **public** key only).
2. **API permissions → Add a permission → Microsoft Graph → Application
   permissions** → add the application-permission list from
   `docs/PERMISSIONS.md` ("application (app-only) permissions for the
   collector").
3. **Grant admin consent for &lt;your org&gt;** again — application
   permissions always require admin consent, there is no user-consent path
   for them.
4. **For every additional tenant the collector will track**, that tenant's
   own Global Administrator must separately grant consent — your consent
   only covers your own tenant. Send them:
   `https://login.microsoftonline.com/{tenantId}/adminconsent?client_id=ab342dfc-cab4-45f3-acdb-3e49d606f418`
   (substitute your own client ID if using a different registration).

**Validate:** On the app registration's **Certificates & secrets** blade,
the uploaded certificate's thumbprint is listed with an expiry date ~2
years out. On **API permissions**, every application permission from
`docs/PERMISSIONS.md` shows **Granted for &lt;your org&gt;**.

**Expected result:** No application permission shows "Not granted." If a
second/third tenant is involved, repeat the admin-consent URL for each and
confirm with that tenant's admin that they saw a consent prompt and
approved it (there's no shared "all tenants" consent action).

### 6.4 Configure `tenants.json`

```bash
cp tenants.example.json tenants.json
```

Edit `tenants.json`:

```json
{
  "clientId": "<the Application (client) ID from step 3.4>",
  "certPath": "./certs/collector.pem",
  "certKeyPath": "./certs/collector.key",
  "collectorToken": "REPLACE-WITH-A-LONG-RANDOM-TOKEN",
  "intervalSeconds": 900,
  "port": 8766,
  "tenants": [
    { "id": "<tenant A GUID>", "displayName": "Tenant A" },
    { "id": "<tenant B GUID>", "displayName": "Tenant B" }
  ]
}
```

Replace each `id` with the real tenant ID (Entra ID → Overview → Tenant ID)
for every tenant this collector should track.

### 6.5 Generate the `collectorToken` — do not type this by hand

This is the step that was getting missed/miskeyed: `collectorToken` gates
the collector's local HTTP API (checked via the `X-IAM-Collector-Token`
header). A short, guessable, or mistyped token — or one that doesn't
**exactly** match `VITE_COLLECTOR_TOKEN` in the dashboard's `.env` (a
trailing space, a dropped character from a copy-paste) — fails **silently**:
every request to the collector gets a plain `401 Unauthorized`, and the
dashboard just shows "Collector unavailable," with nothing pointing at the
token as the actual cause. That's exactly the failure mode that was hit
during setup.

Fix: generate it, don't type it.

```bash
node scripts/generate-token.js
```

**Why this works:** it writes a cryptographically random, URL-safe token
(32 random bytes, base64url-encoded) directly into `tenants.json`'s
`collectorToken` field and prints the same value back to your terminal so
you can copy it into the dashboard's env file in the very next step — no
manual typing, no chance of a transcription mismatch. Run it again any time
to rotate the token; it'll warn you that anything still using the old value
will start getting 401s.

**Validate:**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('tenants.json','utf8')).collectorToken)"
```

**Expected result:** Prints a ~43-character random string (not
`REPLACE-WITH-A-LONG-RANDOM-TOKEN`, and not something you typed yourself).
Keep this value handy — it's needed verbatim in step 6.7.

### 6.6 (Optional) Configure email reports

Skip this if you don't need scheduled/on-demand email reports from the
Reports page — everything else in the collector works without it.

Add an `smtp` block to `tenants.json`:

```json
{
  "...": "... (everything from step 6.4/6.5 stays) ...",
  "smtp": {
    "host": "smtp.office365.com",
    "port": 587,
    "secure": false,
    "user": "reports@yourcompany.com",
    "pass": "<app password or SMTP credential>",
    "from": "IAM Intelligence Reports <reports@yourcompany.com>"
  }
}
```

`pass` is your mailbox's SMTP credential/app password — for Microsoft 365
or Gmail with MFA on the mailbox, that means an app password, not your
normal sign-in password. See `collector/README.md` "Email reports" for the
full explanation of `secure` vs. STARTTLS and what each field does.

**Validate:** covered by step 6.8's `/health` check below — its response
includes `emailConfigured: true` once this block is filled in correctly.

### 6.7 Point the dashboard at the collector

In the dashboard's `.env.local` (or `.env.production` for a real
deployment), add:

```env
VITE_COLLECTOR_URL=http://127.0.0.1:8766
VITE_COLLECTOR_TOKEN=<the exact token from step 6.5>
```

**Why:** These two values must match `tenants.json`'s `port` and
`collectorToken` **exactly**. This is the other half of the token-mismatch
failure mode from step 6.5 — even a perfectly generated token fails if it's
not copied into this file too.

Restart the dev server (`npm run dev`) after editing — again, Vite only
reads `.env*` at startup.

### 6.8 Start the collector and validate end-to-end

```bash
./start.sh       # macOS/Linux, from collector/
```
```powershell
.\start.ps1       # Windows, from collector/
```

**Validate:**

```bash
curl -s http://127.0.0.1:8766/health -H "X-IAM-Collector-Token: <the token from step 6.5>"
```

**Expected result:** A JSON response like:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "tenantCount": 2,
  "tenants": [
    { "id": "...", "displayName": "Tenant A", "certExpiresInDays": 729, "certExpiresAt": "..." }
  ],
  "emailConfigured": false,
  "collectedAt": "..."
}
```

- `tenantCount` matches the number of entries in `tenants.json`.
- `certExpiresInDays` is a positive number close to 730 (fresh cert from
  step 6.2) — not `null` and not negative.
- `emailConfigured` is `true` only if you completed step 6.6.
- A `401` response here means the token in the `curl` command doesn't match
  `tenants.json` — re-check step 6.5.
- A connection-refused error means the collector process isn't running —
  check its terminal output for a startup error (a common one: `tenants.json`
  missing a required field, or Node &lt;22.5 — see step 1).

Then, back in the browser: open the dashboard, and in the top-right source
tabs choose **All Identity Sources**. Also reload the single-tenant
**Microsoft Entra ID** view if you're signed into a tenant this collector
tracks.

**Expected result:** The **All Identity Sources** tab shows a per-tenant
breakdown table and certificate-health table with real data (not "collector
not reachable"). On the single-tenant Entra view, the live-row footer at the
bottom of Overview now reads `Collector snapshot • Auto-refresh every 8s`
instead of `Live Microsoft Graph • Auto-refresh every 30s` — that's the
signal the SPA switched from direct Graph calls to reading the collector's
local snapshot.

### 6.9 Run the collector as a persistent process (production)

`start.sh`/`start.ps1` run the collector in the foreground of whatever
terminal launched them — closing that terminal (or rebooting the machine)
stops it. For production, install it as a real service:

**Windows** (elevated PowerShell, using [NSSM](https://nssm.cc/download)):

```powershell
cd collector\scripts
.\install-windows-service.ps1
```

**Linux** (systemd):

```bash
sudo cp collector/scripts/iam-collector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now iam-collector
```

(Edit `WorkingDirectory`/`User` in the `.service` file for your install path
and a dedicated non-root user first.)

**Validate:**

```powershell
Get-Service IAMIntelligenceCollector   # Windows
```
```bash
sudo systemctl status iam-collector    # Linux
```

**Expected result:** Status shows **Running**. Re-run the `/health` curl
check from step 6.8 — it should still succeed, now with the process
detached from any terminal. Reboot the machine and check again; the service
should have restarted itself automatically.

### 6.10 (Optional) Expose the collector to a dashboard opened remotely

Only needed if the dashboard is served from a public domain and opened from
an admin's laptop (not the same machine the collector runs on) — the
laptop's browser can't reach the server's `127.0.0.1:8766`.

**Do not** bind the collector to `0.0.0.0` to "fix" this — it's plain HTTP
with only a header for access control, so that would expose an unencrypted,
weakly-gated endpoint on the network. Instead, reverse-proxy it through the
dashboard's own HTTPS site. Full IIS instructions (including the exact
`web.config` and the module-install-order pitfall below) are in
`collector/README.md` under "Expose it to the dashboard when it's opened
remotely" — follow that section verbatim, in the order given.

**The one thing worth calling out here because it already happened once:**
install and enable the IIS **URL Rewrite** and **Application Request
Routing** modules, and run `iisreset`, **before** creating `public/web.config`
— never after. IIS doesn't ignore an unrecognized `<rewrite>` section; it
fails the site's **entire home page** with a generic `500 - Internal server
error` until either the modules are installed or the file is removed. If you
hit that: delete `dist/web.config` (and `public/web.config`, so the next
build doesn't reintroduce it) to recover immediately, then redo the module
install in the correct order.

**Validate:**

```powershell
Invoke-WebRequest -Uri "https://<your-dashboard-domain>/collector-api/health" -Headers @{ "X-IAM-Collector-Token" = "<token>" }
```

**Expected result:** Same JSON as the local `/health` check in step 6.8. A
`404` means URL Rewrite/ARR aren't installed or IIS hasn't been reset since
install; a `502` means the collector service itself isn't running; a `500`
on the dashboard's own home page means `web.config` was created before the
modules were installed (see the recovery steps just above).

### 6.11 Back up the collector's state

Nothing the collector needs — the certificate, `tenants.json`, and
`data/history.sqlite` — is stored in git, deliberately (they're
secrets/local state). A server crash with no prior backup loses the
certificate, config, and every day of accumulated trend history, with no
way to recover it after the fact.

```bash
./scripts/backup.sh      # writes collector/backups/collector-backup-<timestamp>.tar.gz
```
```powershell
.\scripts\backup.ps1
```

**Validate:** `ls collector/backups/` shows a new timestamped archive.
**Expected result:** The archive exists and is non-empty
(`tar tzf collector/backups/collector-backup-*.tar.gz | head` lists
`tenants.json`, `certs/`, and `data/` entries). Store it with the same care
as any private key — it contains the certificate's private key in plain
form. To restore on a new machine: `./scripts/restore.sh
/path/to/archive.tar.gz` (or the fresh-bootstrap `--restore=` flag — see
`collector/README.md` "Moving to a new server").

---

## 7. Demo mode (works with zero setup)

If you just want to see the product — or Entra/Graph is down, or you
haven't done step 3 yet — the sign-in screen has a **"View demo dashboard
(no Microsoft sign-in)"** button. It renders the full dashboard (every page:
Overview, Users, Groups, Devices, Applications, Reports, Risk, Privileged
Access, etc.) against realistic fabricated sample data, and — critically —
never makes a network call at all, so it works even when Entra itself is
completely unreachable.

**Validate:** Open the dashboard (`npm run dev` output URL), click the demo
button.

**Expected result:** The dashboard loads immediately with a persistent
banner reading "Showing sample demo data. Not connected to Microsoft
Entra..." Every page is populated (Groups shows type/sync/membership
donuts, Devices shows a compliance donut including an "Unknown" bucket,
Applications shows Expired Secrets/Certs KPIs, Reports shows on-demand CSV
export for every report). Click **Exit demo** (top-right, replaces "Sign
out" while in demo mode) to return to the real sign-in screen. This mode
never blends into a live tenant's numbers — it's a separate, clearly-labeled
mode you have to explicitly enter and exit.

---

## 8. Troubleshooting quick reference

Issues actually hit while setting this up, and their fix:

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard shows "Collector unavailable" even though the collector process is running | `collectorToken` in `tenants.json` doesn't exactly match `VITE_COLLECTOR_TOKEN` in `.env` | Re-run `node collector/scripts/generate-token.js`, copy the printed value into `.env`, restart both processes (step 6.5/6.7) |
| `curl .../health` returns `401` | Same as above, or the token has a typo/extra whitespace | Same fix — never hand-type this value in two places |
| IIS home page returns `500 - Internal server error` after adding the collector reverse proxy | `public/web.config`'s `<rewrite>` section was created before the URL Rewrite/ARR modules were installed | Delete `dist/web.config` and `public/web.config`, install both modules, `iisreset`, then recreate `web.config` (step 6.10) |
| Collector reverse-proxy request returns `404` | URL Rewrite/ARR not installed, or IIS not reset since | Install both modules and run `iisreset` |
| Collector reverse-proxy request returns `502` | Collector process isn't running on the server | Check the collector's own status (step 6.9's `Get-Service`/`systemctl status`) |
| Collector fails to start with an error about `node:sqlite` or a native module build failure | Node version below 22.5, or an old checkout still referencing `better-sqlite3` | `node --version` must be 22.5+; pull latest `collector/` (this project switched to Node's built-in SQLite specifically to avoid native builds) |
| PIM eligibility (Privileged Access page) silently empty despite `RoleManagement.Read.Directory` granted | Graph's `roleEligibilityScheduleInstances` endpoint needs an `Accept-Language` header in some tenants | Already fixed in the collector's Graph client — pull latest `collector/src/graph.js` |
| Groups page: clicking Dynamic, then Cloud-Only/On-Prem Synced, shows no results | Old bug — a KPI click only set its own filter dimension, leaving a stale value in the other one | Fixed — every Groups KPI now resets both filter dimensions on click; pull latest `src/main.jsx` |
| Devices page: "0 compliant, 1 non-compliant" out of many more devices, rest unaccounted for | Devices with no compliance state reported at all (`isCompliant` is `null` — not enrolled in Intune/an MDM) weren't counted anywhere | Fixed — Devices page now has an explicit "Unknown / not reported" KPI and donut segment so every device is accounted for |
| Reports page is blank | It was an unbuilt placeholder in earlier versions | Fixed — see the on-demand and scheduled-email reports in step 6.6/`collector/README.md` |
| Email report never arrives | No `smtp` block in `tenants.json`, or `emailConfigured: false` in `/health` | Add the `smtp` block (step 6.6), restart the collector, re-check `/health` |
| `npm run build` warns about a chunk over 500 kB | Expected — the whole SPA ships as one JS bundle by design (no server-side rendering, no router) | Not an error; safe to ignore for this project's size |
| Node prints `ExperimentalWarning: SQLite is an experimental feature...` on collector startup | Node's own warning for its built-in `node:sqlite` module | Expected and harmless — not a bug, nothing to fix |

---

## 9. Command cheat sheet

```bash
# Dashboard — local dev
npm install && npm run dev

# Dashboard — production build
npm run build && npm run preview

# Collector — one-time setup
cd collector
npm install
node scripts/generate-cert.js
cp tenants.example.json tenants.json
node scripts/generate-token.js        # fills in collectorToken for real
# ... edit tenants.json: clientId, tenants[], optional smtp block ...

# Collector — run
./start.sh                            # macOS/Linux, foreground
.\start.ps1                           # Windows, foreground

# Collector — validate
curl -s http://127.0.0.1:8766/health -H "X-IAM-Collector-Token: <token>"

# Collector — backup / restore
./scripts/backup.sh
./scripts/restore.sh /path/to/collector-backup-<timestamp>.tar.gz

# Fresh server, both pieces at once
./scripts/bootstrap-server.sh --with-collector
```
