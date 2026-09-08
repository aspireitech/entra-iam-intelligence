# IAM Intelligence Collector (optional, unattended, multi-tenant)

This is the answer to two requirements the browser SPA cannot satisfy on its
own: continuous collection **whether a user has the dashboard open or not**,
and Graph authentication via a **certificate you generate and control**
instead of a client secret.

It runs entirely on infrastructure you choose — your own server, the same
box that already runs `agent/IAM-AD-Agent.ps1`, a VM, a container. **It does
not require Azure Functions, Key Vault, or any specific cloud platform.**
The private key never leaves the machine it's generated on and is never
sent to Microsoft, Anthropic, or anywhere else — only the public certificate
is uploaded to the Entra app registration.

## How the auth actually works

1. You generate a certificate (self-signed is normal and sufficient here).
2. You upload only the **public key** (`.cer`/`.pem`) to the Entra app
   registration's *Certificates & secrets* blade.
3. The collector signs its Graph token requests with the **private key**,
   which stays on this machine.
4. Azure AD returns an app-only access token. No secret crosses the wire.

This uses **application permissions** (app-only), which is a different
consent model from the browser SPA's delegated permissions:

- Application permissions always require **admin consent** — there is no
  user-consent path.
- Because the app registration is multitenant, **each tenant's own Global
  Administrator must grant that consent for their tenant** — your consent
  does not extend to other tenants. Direct each tenant admin to:
  `https://login.microsoftonline.com/{tenantId}/adminconsent?client_id=ab342dfc-cab4-45f3-acdb-3e49d606f418`
  (or have them approve it from *Enterprise Applications → \[app name] → Permissions*
  in their own tenant).

See `docs/PERMISSIONS.md` for the exact application-permission list.

## 1. Generate the certificate

```bash
npm install               # first time only
node scripts/generate-cert.js
```

No `openssl` needed — this generates the certificate in pure JavaScript
(the `selfsigned` package), so it works the same on Windows, macOS, and
Linux with nothing installed beyond Node itself. (`scripts/bootstrap-server.ps1`/`.sh
--with-collector`, from the repo root, runs this for you automatically.)
Verified end-to-end against real Azure AD: a certificate generated this way
successfully authenticates an app-only token request, identically to one
generated with `openssl`.

Prefer `openssl` anyway? That still works:

```bash
openssl req -x509 -newkey rsa:2048 -keyout collector/certs/collector.key \
  -out collector/certs/collector.pem -days 730 -nodes \
  -subj "/CN=IAM Intelligence Collector"
```

This produces a certificate valid for 730 days (2 years). Set a calendar
reminder well before that — the collector's own `/health` endpoint reports
`certExpiresInDays`, and the dashboard should treat anything under 30 days
as a rotation trigger (same threshold as application-credential expiry
elsewhere in the product).

**Never commit `collector/certs/*.key` or `*.pem` to git** — `.gitignore`
already excludes them.

## 2. Register the certificate and permissions in Entra

1. Open the existing app registration (`ab342dfc-cab4-45f3-acdb-3e49d606f418`,
   or a dedicated one if you'd rather keep app-only and delegated permissions
   on separate registrations) → **Certificates & secrets → Certificates →
   Upload certificate** → upload `collector/certs/collector.pem`.
2. **API permissions → Add a permission → Microsoft Graph → Application
   permissions** → add the scopes listed in `docs/PERMISSIONS.md` under
   "Microsoft Entra ID — application (app-only) permissions for the
   collector."
3. Click **Grant admin consent** for your own tenant, and send each
   additional connected tenant's admin the admin-consent URL above.

## 3. Configure the collector

```bash
cd collector
cp tenants.example.json tenants.json
```

Edit `tenants.json`:

```json
{
  "clientId": "ab342dfc-cab4-45f3-acdb-3e49d606f418",
  "certPath": "./certs/collector.pem",
  "certKeyPath": "./certs/collector.key",
  "collectorToken": "<a long random string>",
  "intervalSeconds": 900,
  "port": 8766,
  "tenants": [
    { "id": "<tenant A GUID>", "displayName": "Tenant A" },
    { "id": "<tenant B GUID>", "displayName": "Tenant B" }
  ]
}
```

- `intervalSeconds` — how often every configured tenant is re-collected.
  Default is 900s (15 min); the enforced floor is 300s (5 min) because each
  collection cycle fires a full round of Graph calls **per tenant**, and
  polling more often than that multiplies risk of hitting Graph
  report/beta-endpoint throttling across tenants. This is intentionally
  lower-frequency than the single-tenant browser dashboard's 60s refresh.
- A tenant entry can override `clientId`/`certPath`/`certKeyPath` if that
  tenant uses its own app registration/certificate instead of the shared one.
- `collectorToken` gates the local HTTP API. Set one before exposing this
  beyond `127.0.0.1` (e.g. behind a reverse proxy) — without it, `/health`,
  `/tenants`, `/tenants/:id/snapshot` and `/combined` are unauthenticated.

## 4. Run it

```powershell
.\start.ps1     # Windows
```

```bash
./start.sh      # macOS/Linux
```

Either script installs dependencies on first run and then starts the
collector. Equivalent to running `npm install && npm start` directly.

**Requires Node.js 22.5+** (the dashboard SPA only needs Node 20+ — this
higher requirement is specific to the collector). History is stored using
Node's own built-in SQLite module (`node:sqlite`), not a third-party native
package — nothing to compile, no C++ build toolchain, no Visual Studio
required on Windows. You'll see a one-line `ExperimentalWarning: SQLite...`
message from Node itself on startup; that's expected and harmless, not an
error. (An earlier version of this collector used `better-sqlite3`, which
needs to compile a native addon on machines without a matching prebuilt
binary — that required Visual Studio's C++ build tools on Windows. Switched
to Node's built-in SQLite specifically to remove that dependency.)

The collector runs one collection pass immediately, then on the configured
interval. It listens on `127.0.0.1:8766` by default: `/health`, `/tenants`,
`/tenants/:id/snapshot`, `/tenants/:id/history?days=N`,
`/tenants/:id/delta?days=N`, `/tenants/:id/app-events?days=N`, `/combined`.

`.\start.ps1` / `./start.sh` run the collector in the foreground of whatever
terminal launched them - closing that terminal, or rebooting the machine,
stops it. That's fine for setup and testing, but production needs the
collector running unattended, restarting itself on crash, and starting
automatically on boot. Two ways to get that, matching this repo's existing
platform split:

**Windows** - install it as a real Windows Service using
[NSSM](https://nssm.cc/download) (a small, well-known third-party service
wrapper - download it yourself rather than having a script fetch and run an
executable for you):

```powershell
# From an elevated (Run as Administrator) PowerShell prompt:
cd collector\scripts
.\install-windows-service.ps1                        # if nssm.exe is on PATH
.\install-windows-service.ps1 -NssmPath C:\tools\nssm.exe   # otherwise
```

This registers the service to auto-start at boot, restart on crash (capped
so a persistent failure doesn't spin forever), and log to
`collector\logs\collector.out.log` / `collector.err.log`. Manage it with the
usual service commands (`Get-Service IAMIntelligenceCollector`,
`Restart-Service IAMIntelligenceCollector`) or remove it with
`.\uninstall-windows-service.ps1`.

**Linux** - a systemd unit template is at
`collector/scripts/iam-collector.service`. Edit `WorkingDirectory` and
`User` for your install path and a dedicated non-root user, then:

```bash
sudo cp collector/scripts/iam-collector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now iam-collector
```

Either way, this only manages the **collector**. The dashboard SPA needs no
long-running process at all in production - see "Deploying the dashboard"
in the top-level `README.md`.

## 5. Point the SPA at it

In the SPA's `.env.local` (or `.env.production` for a real deployment):

```env
VITE_COLLECTOR_URL=http://127.0.0.1:8766
VITE_COLLECTOR_TOKEN=<same collectorToken as tenants.json>
```

Selecting **All Identity Sources (Combined)** in the dashboard's source
tabs will then show aggregated KPIs across every configured tenant, a
per-tenant breakdown, and each tenant's certificate expiry status.

**The single-tenant Microsoft Entra ID view uses the collector too, automatically.**
If the tenant you sign into matches a tenant ID already tracked in
`tenants.json`, the dashboard reads that tenant's `/tenants/:id/snapshot`
from the collector instead of querying Graph directly - refreshing every
~8s (`VITE_COLLECTOR_REFRESH_INTERVAL_SECONDS`, default 8) instead of every
30s, since it's a local read rather than a live Graph call. No separate
setup beyond the two env vars above; the live-row footer at the bottom of
the Overview page says which mode is active ("Collector snapshot" vs. "Live
Microsoft Graph"). If the collector is unreachable, isn't tracking this
tenant yet, or its first collection cycle for this tenant hasn't completed,
the dashboard falls back to the direct Graph query it always used before -
it never goes blank because of this.

This only works when the browser can reach the collector - by default that
means the same machine (`VITE_COLLECTOR_URL=http://127.0.0.1:8766`). See
`docs/ARCHITECTURE.md` §2d for what multi-machine deployment would need.

### Expose it to the dashboard when it's opened remotely

The common production case - the dashboard served from a public domain and
opened from an admin's laptop, even when the collector runs on that same
server - is **not** the same-machine case above: it's the visitor's browser,
not the server, that would have to reach `127.0.0.1:8766`, and a laptop's
own loopback address obviously isn't the server's. Don't "fix" this by
binding the collector to `0.0.0.0` - it only speaks plain HTTP and its only
access control is the `X-IAM-Collector-Token` header, so that would put an
unencrypted, weakly-gated endpoint directly on the network.

Instead, reverse-proxy it through the dashboard's own IIS site, reusing its
existing HTTPS certificate.

**Install the two IIS modules and enable proxying *before* creating the
`web.config` below - not after.** A `<rewrite>` section in `web.config` is
not something IIS silently ignores when the URL Rewrite module isn't
installed: it's an unrecognized configuration section, and IIS fails the
*entire site* with a generic `500 - Internal server error` - every page,
not just the proxied path - until either the module is installed or the
file is removed. This isn't hypothetical; it's exactly what happened the
first time this was shipped as a repo-tracked file that landed in `dist\`
on a server that hadn't done this section yet. That's also why this file is
**not** committed to the repo or auto-copied by the build (unlike most of
`public/`) - create it locally on each server, only once you're ready to
turn the proxy on, the same way `.env.production` is created locally rather
than committed.

```powershell
# From an elevated PowerShell prompt. Confirm the current release at
# https://www.iis.net/downloads/microsoft/url-rewrite and
# https://www.iis.net/downloads/microsoft/application-request-routing
# before relying on these exact URLs - they're the long-standing official
# Microsoft download-center links as of this writing, unchanged since ARR 3.0/
# URL Rewrite 2.1 shipped, but check if either 404s.
Invoke-WebRequest -Uri "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi" -OutFile "$env:TEMP\urlrewrite.msi"
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\urlrewrite.msi`" /quiet /norestart" -Wait

Invoke-WebRequest -Uri "https://download.microsoft.com/download/e/9/8/e9849d6a-020e-47e4-9fd0-a023e99b54eb/requestRouter_amd64.msi" -OutFile "$env:TEMP\arr.msi"
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\arr.msi`" /quiet /norestart" -Wait

# ARR installs with proxying disabled by default - enable it server-wide (a
# no-op, not a wildcard route: only requests matching a site's own rewrite
# rules, like the one in web.config below, ever get proxied anywhere):
Import-Module WebAdministration
Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -filter "system.webServer/proxy" -name "enabled" -value "True"

# IIS needs a restart to pick up newly installed modules:
iisreset
```

Only now, with both modules installed and IIS restarted, create the rewrite
rule - in `public\web.config` in the repo checkout, so it survives every
future `npm run build` on *this* server (Vite copies everything in `public\`
into `dist\` as-is):

```powershell
Set-Content -Path public\web.config -Encoding UTF8 -Value @'
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Collector API reverse proxy" stopProcessing="true">
          <match url="^collector-api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:8766/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
'@
```

Then point the dashboard at the proxied path instead of the raw loopback
address, and rebuild (this bakes `VITE_COLLECTOR_URL` into the static JS at
build time, same as any other `.env.production` change, and copies the
`web.config` above into `dist\` in the same step):

```env
VITE_COLLECTOR_URL=https://<your-dashboard-domain>/collector-api
VITE_COLLECTOR_TOKEN=<same collectorToken as tenants.json>
```

```powershell
npm run build
```

Validate: `Invoke-WebRequest -Uri "https://<your-dashboard-domain>/collector-api/health" -Headers @{ "X-IAM-Collector-Token" = "<collectorToken>" }` should return the same JSON the collector's own `http://127.0.0.1:8766/health` returns locally on the server. A 404 usually means URL Rewrite/ARR aren't installed or IIS hasn't been reset since; a 502 usually means the collector service itself isn't running; a **500 on the dashboard's own home page** means `web.config` was created before the modules were installed - remove `dist\web.config` (and `public\web.config`, so the next build doesn't reintroduce it) to recover immediately, then redo the module install first.

## Moving to a new server (or recovering from a crash)

Nothing the collector needs is stored in this git repo - the certificate,
`tenants.json`, and `data/history.sqlite` are all `.gitignore`d, deliberately,
because they're secrets/local state. That means a server crash **without a
prior backup loses the certificate, config, and every day of accumulated
trend history** - there is no way to recover that after the fact. Take
backups proactively, not just at the moment you plan to move.

```bash
./scripts/backup.sh                    # writes collector/backups/collector-backup-<timestamp>.tar.gz
```
```powershell
.\scripts\backup.ps1
```

The archive contains the certificate's **private key** — store and transport
it with the same care as any private key (encrypted storage, restricted
access, never email/chat).

On the new machine, either restore directly:

```bash
./scripts/restore.sh /path/to/collector-backup-<timestamp>.tar.gz
```
```powershell
.\scripts\restore.ps1 -Archive 'C:\path\to\collector-backup-<timestamp>.zip'
```

...or restore as part of a full fresh-server bootstrap (see root
`scripts/bootstrap-server.ps1`/`.sh`, which also sets up the dashboard):

```bash
./scripts/bootstrap-server.sh --restore=/path/to/collector-backup-<timestamp>.tar.gz
```

Restoring keeps the same certificate (same thumbprint), so **no changes are
needed in the Entra app registration or admin consent** — the new machine
picks up exactly where the old one left off, history included. Both scripts
refuse to overwrite an existing `tenants.json`/`certs`/`data` on the target
machine unless you pass `--force` (`-Force` in PowerShell).

**Setting up a brand-new server with no prior history?** Skip backup/restore
entirely and use `scripts/bootstrap-server.ps1`/`.sh --with-collector` from
the repo root — it generates a fresh certificate, scaffolds `tenants.json`,
and installs dependencies for both the dashboard and the collector in one
pass.

## Historical trend and "who registered this app"

Every collection cycle appends a row to `collector/data/history.sqlite`
(`snapshots` table) instead of overwriting the last one — this is what
makes trend/delta queries possible at all; the single-tenant browser
dashboard has no persistent process and cannot do this on its own.

- `GET /tenants/:id/history?days=30` — every collected snapshot's key
  metrics in the window, oldest first.
- `GET /tenants/:id/delta?days=30` — first-vs-latest comparison in the
  window (`{from, to, change, pct}` per metric). Returns
  `{available:false}` rather than a fabricated percentage when there are
  fewer than two data points yet.

Separately, each cycle also queries
`/auditLogs/directoryAudits?$filter=activityDisplayName eq 'Add application'`
(no new permission — this is covered by `AuditLog.Read.All`, already
requested) and stores new-application events in the `app_events` table.
`GET /tenants/:id/app-events?days=30` returns them with an `actor_type` of
`user` or `application`: a human interactively registered it (portal, CLI,
PowerShell) vs. an automation using its own credential (CI/CD, Terraform, a
script). When the acting application has a display name it's included as
`actor_name` — often enough to identify the actual source. Graph does not
expose a finer-grained "manual vs. Postman vs. internal tool" label than
this; nothing here claims more precision than that.

## What this version does and doesn't do

Implemented: users/applications/groups/devices/sign-in counts, risky users,
privileged-role assignments, Conditional Access policy count, stale-user
count, MFA registration gap, license SKU inventory + stale-licensed-account
count, application credential (secret/certificate) expiry, append-only
historical trend/delta, and new-application actor tracking.

Not yet implemented: sign-in trend/recent-activity history (only the point
counts are stored, not the full sign-in log), and a shared/multi-user Risk
Register (the SPA's exception register is still browser-local `localStorage`
— extending it into this database is a natural next step, not yet done).
