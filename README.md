# IAM Intelligence

**Identity. Secure. Simplified.**

A vendor-neutral identity intelligence command center. The first production connector is Microsoft Entra ID. The experience turns identity telemetry into a small number of meaningful daily decisions: **what changed, what needs attention, why it matters, and what to do next.**

## Current status: live Microsoft Entra connector

The dashboard is wired to real, delegated Microsoft Graph queries — **there is no demo/mock data in the live app.** When a metric can't be retrieved (missing permission, unsupported API, no data yet) the UI shows `—` or `Permission required` rather than a fabricated value. See `docs/PHASE-1-2-3-TEST-MATRIX.md` for the full scope-by-scope validation matrix, and `docs/ARCHITECTURE.md` for system diagrams, data flow, and a full per-panel reference of where every metric comes from and what its colors mean.

Implemented:

- Redirect-based MSAL sign-in with silent token reuse and progressive (not forced) consent
- Live tenant identity (real organization display name and tenant ID, not a placeholder)
- Executive Overview: users, applications, groups, devices, sign-ins — all from live Graph counts
- Application usage / inactivity buckets from service-principal sign-in activity (beta endpoint, with graceful fallback)
- Need Attention signals (MFA gaps, risky users, stale accounts, privileged roles, inactive apps) sourced from live queries, never defaulted to zero on API failure
- Identity Health Score computed from live MFA/risk/stale-user/app-hygiene signals, not a static number
- Progressive security-permission consent (ID Protection, privileged roles, Conditional Access) requested separately from core scopes
- Licenses page: purchased/assigned/available seats per Microsoft 365 SKU, stale-licensed-account detection, reclamation recommendations (`Organization.Read.All`, progressive consent)
- Application Credential Expiry: tenant app registrations' client secrets/certificates, with a ≤30-day rotation warning
- Auto-refresh every `VITE_REFRESH_INTERVAL_SECONDS` (default 60s) while the tab is open and signed in
- Data Sources control plane: Microsoft Entra (live), a read-only Active Directory agent (`agent/IAM-AD-Agent.ps1`), and an optional certificate-authenticated multi-tenant collector (`collector/`, see its README) powering a combined cross-tenant view; SailPoint and Saviynt are listed but not yet built, and are never shown as connected
- Toxic Combinations: privileged users who also lack MFA, are flagged risky, or are stale 90+ days, cross-referenced by identity rather than shown as unrelated counts
- Risk Register: acknowledged Need Attention / Toxic Combination findings with a required exception note (currently browser-local, not yet shared across users)
- Historical trend, delta, and "who registered this application" (person vs. automation) via the collector's SQLite store and directory-audit tracking — requires the collector running and tracking the tenant you're viewing
- Sign-out clears the MSAL session and local tenant/session state

Not yet implemented (see `docs/PHASE-1-2-3-TEST-MATRIX.md` and the product handoff for the full roadmap): a normalized cross-source entity model, per-metric "how this was calculated" drill-down for every panel, a separate tenant Disconnect action, a shared/multi-user Risk Register, sign-in-log history (only point counts are stored), and the SailPoint/Saviynt connectors themselves (permission model documented in `docs/PERMISSIONS.md`, not yet built).

**No Microsoft client secret or certificate is ever used in the browser.**

## Setting up a new server, or moving to one

`scripts/bootstrap-server.ps1` / `.sh` sets up the dashboard and, if you
want, the collector in one pass on a fresh machine (`--with-collector`).
Moving an existing collector (or recovering from a crash) needs its
certificate, config, and accumulated history explicitly backed up first —
none of that is in git, deliberately, since it's secrets/local state. See
"Moving to a new server" in `collector/README.md`.

## Run locally

Requirements: Node.js 20+ recommended.

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite (normally `http://localhost:5173`).

To create a production build:

```bash
npm run build
npm run preview
```

`npm run preview` starts Vite's own preview server, which - like
`npm run dev` - is a foreground process for local verification only, not a
production deployment.

## Deploying the dashboard

`npm run build` produces a `dist/` folder of plain static files (HTML, JS,
CSS) - there is no server-side rendering and no client-side router (the app
has exactly one route, `/index.html`, and switches between panels with
internal state), so **no long-running Node process, and no URL-rewrite
config, is needed to serve it in production.** Any static web server works:

- **IIS on Windows** - create a site (or a folder under an existing one)
  pointed at `dist/`; IIS is already a Windows Service, so once it's running
  the dashboard is "up" with nothing further to manage. Set `VITE_*` env
  vars (client ID, `VITE_COLLECTOR_URL`, etc.) at build time - they're baked
  into the static output, not read at runtime.
- **nginx / Apache / any static host** (S3+CloudFront, Azure Static Web
  Apps, etc.) - copy `dist/` to the document root; same rule, no rewrite
  rules needed.

Rebuild and redeploy `dist/` whenever `VITE_*` config changes or the app is
updated; there's no runtime config reload.

The collector is the one piece that does need to run continuously in the
background - see "Run it as a persistent process" in `collector/README.md`
for the Windows Service (NSSM) and Linux (systemd) installers.

## Product direction

Next milestones (see the full engineering handoff for detail): a source-agnostic normalized entity model so Entra and Active Directory data share one schema, per-metric calculation drill-down, application governance detail (owners, credential expiry), and additional connectors (Microsoft 365, Okta, SailPoint, CyberArk, ServiceNow, Splunk). Write/destructive Graph permissions stay out of the monitoring MVP.

## Design source of truth

The approved visual reference is the IAM Intelligence executive dashboard: dark enterprise UI, clean alignment, compact KPI cards, application lifecycle intelligence, Need Attention, AI Recommendations, and operator drill-downs.

## Repository

`aspireitech/entra-iam-intelligence`
