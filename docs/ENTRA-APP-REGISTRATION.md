# IAM Intelligence — Microsoft Entra App Registration

## Product identity

**IAM Intelligence**  
*Identity. Secure. Simplified.*

The first connector is Microsoft Entra. The platform is intended to expand to Active Directory and other IAM sources without changing the master product identity.

## 1. App registration

For the SaaS/product model, use a **multitenant** application:

- Supported account types: **Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)**
- Platform: **Single-page application (SPA)**
- Local redirect URI: `http://localhost:5173`
- Product client ID for the current local build: `ab342dfc-cab4-45f3-acdb-3e49d606f418`
- Authority: `https://login.microsoftonline.com/organizations`

Do not create a client secret for the SPA. The browser application uses MSAL authorization code flow with PKCE.

## 2. Initial delegated Microsoft Graph permissions

IAM Intelligence is read-only in the monitoring MVP. No write/delete permissions are requested.

| Permission | Purpose |
|---|---|
| `User.Read` | Sign in and identify the current operator |
| `User.Read.All` | User inventory, manager relationships (stale/unmanaged-account signals) |
| `Application.Read.All` | Application and service-principal inventory |
| `Group.Read.All` | Groups and memberships |
| `Device.Read.All` | Device inventory |
| `AuditLog.Read.All` | Sign-in and directory audit telemetry, MFA registration report, service-principal activity (beta) |

Requested separately, only when the operator opts into security intelligence (progressive consent, see `src/entraAuth.js` `SECURITY_SCOPES`):

| Permission | Purpose |
|---|---|
| `IdentityRiskyUser.Read.All` | Entra ID Protection risky-user data |
| `RoleManagement.Read.Directory` | Privileged directory role assignments |
| `Policy.Read.All` | Conditional Access policy inventory |
| `Organization.Read.All` | License SKU inventory (`/subscribedSkus`) — requested only when the Licenses page is opened |

`ProvisioningLog.Read.All` is intentionally optional and should be requested only when the Provisioning capability is enabled.

Do not add broad `Directory.Read.All` just to make the MVP work.

## 3. Admin consent

Because several monitoring permissions require administrator consent, the tenant administrator must approve the permissions for the tenant. For SPAs using MSAL.js, Microsoft documents explicit admin consent for these permissions.

The product's Connect Tenant flow requests consent only when the administrator chooses to connect the tenant.

## 4. Local setup

From the repository root:

```powershell
.\scripts\start.ps1
```

The bootstrap script automatically creates `.env.local` with the product client ID and organizations authority. `.env.local` is ignored by Git.

## 5. Tenant connection flow

```text
Open IAM Intelligence
        ↓
Sign in with Microsoft
        ↓
Connect Tenant
        ↓
Microsoft consent / admin consent
        ↓
Read-only Graph access
        ↓
Initial tenant sync
        ↓
Executive dashboard
```

## 6. Important local testing note

The app registration must have the SPA redirect URI configured exactly as `http://localhost:5173`. If the app registration remains single-tenant, the multitenant `organizations` authority will not work for other tenants; convert the registration to multitenant before testing the SaaS flow.

## 7. Historical application intelligence

Microsoft Entra log retention is limited by license and log type. IAM Intelligence should not claim 90/180-day historical usage from a single live Graph query. The product will maintain its own historical observation layer (or customer-controlled export/storage) to build 30/90/180-day application-usage intelligence over time.
