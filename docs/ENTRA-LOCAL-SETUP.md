# Local Microsoft Entra connection

## 1. Register the application

Create a Microsoft Entra App Registration for **Entra IAM Intelligence**.

Use:

- **Supported account types:** Accounts in any organizational directory (multitenant)
- **Platform:** Single-page application (SPA)
- **Redirect URI:** `http://localhost:5173`

A multitenant application uses the Microsoft identity platform's `organizations` authority so work/school accounts from different Entra tenants can authenticate. Microsoft documents this multitenant model and the `/organizations` endpoint for organizational accounts. 

## 2. Add delegated Microsoft Graph permissions

For the initial monitoring MVP, configure these **Delegated permissions**:

| Permission | Purpose |
|---|---|
| `User.Read` | Sign the current user in and read their basic profile |
| `User.ReadBasic.All` | Read basic profiles for tenant users |
| `Application.Read.All` | Read applications and service principals |
| `Group.Read.All` | Read groups |
| `Device.Read.All` | Read devices |
| `AuditLog.Read.All` | Read sign-in and directory audit logs |

No write/delete permissions are requested.

Microsoft Graph identifies `Application.Read.All` as the least-privileged delegated permission for listing applications and service principals, `User.ReadBasic.All` for basic user profiles, and `AuditLog.Read.All` for sign-in logs. citehttps://learn.microsoft.com/en-us/graph/api/application-list?view=graph-rest-1.0https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0https://learn.microsoft.com/en-us/graph/api/signin-list?view=graph-rest-1.0

Provisioning logs are intentionally separated from the initial consent set. When the Provisioning view is enabled, the application can request `ProvisioningLog.Read.All` incrementally. Microsoft lists that permission as delegated read access to provisioning log data. citehttps://learn.microsoft.com/en-us/graph/permissions-reference

## 3. Admin consent

Most tenant-wide monitoring permissions above require administrator consent. If the tenant's consent policy blocks the signed-in user, the Connect flow should stop and tell the user that an authorized administrator must approve the requested read-only permissions. Microsoft documents that permissions requiring admin consent must be approved by an appropriately authorized administrator in the customer's tenant. citehttps://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experiencehttps://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent

## 4. Configure the local machine

Copy `.env.example` to `.env.local`, or let the bootstrap script create it:

```text
VITE_ENTRA_CLIENT_ID=<Application client ID>
VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/organizations
```

The client ID is not a secret. Do **not** put client secrets or certificates into this SPA project.

## 5. Run

Windows:

```powershell
.\scripts\start.ps1
```

If Node.js is missing and you want the script to attempt installation through Windows Package Manager:

```powershell
.\scripts\setup.ps1 -InstallNode
```

macOS/Linux:

```bash
bash ./scripts/start.sh
```

The script validates Git, Node.js, npm, the project files, environment configuration, dependencies, and a production build before starting Vite.

## 6. Connect/disconnect behavior

The dashboard has an explicit **Connect** control. Sign-in first uses `User.Read`; choosing **Connect tenant** then requests the monitoring scopes through MSAL's interactive token acquisition. This is incremental consent rather than asking for all monitoring permissions on the initial sign-in.

**Disconnect tenant** clears the local MSAL session for the connected account. It does not revoke tenant-wide administrator consent. Tenant administrators can revoke application permissions from the Microsoft Entra Enterprise Application if they want to remove the application's authorization entirely. citehttps://learn.microsoft.com/en-us/entra/identity-platform/howto-update-permissions

## Security boundary for v0.2

The browser calls Microsoft Graph with delegated access tokens issued to the signed-in user. No client secret is stored in the browser. The MVP requests read-only permissions only. A future production SaaS architecture should move ingestion, tenant isolation, storage, webhooks/delta synchronization, and long-running analysis to a protected backend/service layer rather than relying on a browser tab for continuous ingestion.
