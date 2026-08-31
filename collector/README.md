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
  Default/minimum enforced is 900s (15 min) because each collection cycle
  fires a full round of Graph calls **per tenant**; polling more often than
  that multiplies risk of hitting Graph report/beta-endpoint throttling
  across tenants. This is intentionally lower-frequency than the single-tenant
  browser dashboard's 60s refresh.
- A tenant entry can override `clientId`/`certPath`/`certKeyPath` if that
  tenant uses its own app registration/certificate instead of the shared one.
- `collectorToken` gates the local HTTP API. Set one before exposing this
  beyond `127.0.0.1` (e.g. behind a reverse proxy) — without it, `/health`,
  `/tenants`, `/tenants/:id/snapshot` and `/combined` are unauthenticated.

## 4. Run it

```bash
npm install
npm start
```

The collector runs one collection pass immediately, then on the configured
interval. It listens on `127.0.0.1:8766` by default (`/health`, `/tenants`,
`/tenants/:id/snapshot`, `/combined`).

Run it as a persistent process the same way you'd run the AD agent — a
Windows service (e.g. via NSSM or Task Scheduler "at startup"), a systemd
unit, or a container. It has no dependency on a browser tab being open.

## 5. Point the SPA at it

In the SPA's `.env.local`:

```env
VITE_COLLECTOR_URL=http://127.0.0.1:8766
VITE_COLLECTOR_TOKEN=<same collectorToken as tenants.json>
```

Selecting **All Identity Sources (Combined)** in the dashboard's source
tabs will then show aggregated KPIs across every configured tenant, a
per-tenant breakdown, and each tenant's certificate expiry status.

## What this first version does and doesn't do

Implemented: users/applications/groups/devices/sign-in counts, risky users,
privileged-role assignments, Conditional Access policy count, stale-user
count, MFA registration gap, license SKU inventory + stale-licensed-account
count, application credential (secret/certificate) expiry — the same
metrics the single-tenant delegated dashboard shows, collected instead via
app-only permissions on a schedule.

Not yet implemented: historical trend storage (each tenant's snapshot file
holds only the latest collection — no 30/90/180-day time series yet),
sign-in trend/recent-activity detail, a real database (snapshots are plain
JSON files in `collector/data/`, which is fine for a handful of tenants but
should become a real store before this scales much further).
