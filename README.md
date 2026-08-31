# Entra IAM Intelligence

**Identity. Secure. Simplified.**

A focused identity operations command center for Microsoft Entra ID. The first experience turns identity telemetry into a small number of meaningful daily decisions: **what changed, what needs attention, why it matters, and what to do next.**

## v0.1 local prototype

The current build is a browser-based executive command center using realistic demo data. It includes:

- Executive Overview
- Identity health KPIs
- Application usage and 30/90/180-day inactivity views
- Need Attention signals
- User risk overview
- Sign-in trend
- Identity Health Score
- AI recommendation cards
- Recent activity
- Data source status
- Interactive attention details
- Custom dashboard builder with predefined templates

The data is intentionally mocked in v0.1. **No Microsoft credentials are stored or required.**

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

## Product direction

The next milestone is the real Microsoft Entra connector:

```text
Microsoft Entra
      ↓
Microsoft Graph (read-only)
      ↓
Identity data model
      ↓
Change + baseline detection
      ↓
Attention engine
      ↓
AI explanation / recommendation
      ↓
Entra IAM Intelligence
```

The initial connector will focus on applications/service principals, users/groups, sign-ins, audit activity and provisioning signals. We will keep write/destructive permissions out of the monitoring MVP.

## Design source of truth

The approved visual reference is the Entra IAM Intelligence executive dashboard: dark enterprise UI, clean alignment, compact KPI cards, application lifecycle intelligence, Need Attention, AI Recommendations, and operator drill-downs.

## Repository

`aspireitech/entra-iam-intelligence`
