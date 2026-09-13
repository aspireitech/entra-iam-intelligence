# IAM Intelligence marketing site

A single-page marketing/lead-capture site for the IAM Intelligence dashboard.
Plain PHP + MySQL - no framework, no build step. Separate from the dashboard
app (`src/`, `collector/`) on purpose: different runtime, different hosting
target, and it should be able to change without ever touching the product.

## What it does

- `public/index.php` - the one-page site (hero, problem/ROI, features,
  security model, lead form).
- `public/submit-lead.php` - validates and stores a lead capture form
  submission in MySQL, then returns the real demo URL only on success. The
  demo link is never present in the page's HTML/JS - it only comes back from
  a successful POST, so filling the form is actually required to get it, not
  just cosmetic.
- `public/admin.php?token=...` - a lightweight leads list + CSV export, gated
  by a shared secret (`admin_token` in `config.php`), same pattern as the
  collector's `collectorToken`.
- `config.php` (you create this, gitignored) and `schema.sql` live outside
  `public/`, so DB credentials are never web-accessible even if `.htaccess`
  is misconfigured or ignored.

## The demo link

The dashboard's demo mode has always required clicking a button on its
sign-in screen. `src/authBoot.js` now also supports `?demo=1` as a direct
deep-link (added alongside this site) so `config.php`'s `demo_url` can point
straight into a working demo instead of a generic sign-in page:

```
https://iamdashboard.aspireitech.net/?demo=1
```

Point this at wherever the real dashboard is actually deployed.

## Deploying on Hostinger

1. **Create the database.** In hPanel → Databases → MySQL Databases, create a
   new database and a user with full privileges on it. Note the host (usually
   `localhost`), database name, username, and password.
2. **Import the schema.** Open phpMyAdmin for that database (hPanel gives you
   a direct link) → Import → choose `schema.sql` → Go. This creates the
   `leads` and `lead_rate_limit` tables.
3. **Upload the files.** Via hPanel's File Manager or FTP, upload this whole
   `marketing/` folder to your hosting account (e.g. alongside your other
   sites, not necessarily under `public_html` directly - see the next step).
4. **Point a subdomain at `marketing/public`.** In hPanel → Domains →
   Subdomains, create the subdomain you want (e.g. `iam.aspireitech.net`) and
   set its document root to `marketing/public` - not `marketing/` itself.
   This is what keeps `config.php` and `schema.sql` outside the web root.
5. **Create `config.php`.** Copy `config.php.example` to `config.php` (same
   directory, next to `schema.sql`) and fill in:
   - Your real DB host/name/user/password from step 1.
   - `demo_url` - the working `?demo=1` link from above.
   - `admin_token` - generate one with `openssl rand -hex 24` (or any long
     random string) so you can view captured leads later.
   - `notify_email` (optional) - your inbox, if you want an email whenever a
     lead comes in. PHP's `mail()` on shared hosting is best-effort; if these
     don't arrive, check hPanel's mail/SPF settings. Leads are saved to MySQL
     regardless of whether the email succeeds - that's the source of truth.
6. **Verify.** Visit the subdomain, submit the lead form with a real-looking
   test entry, confirm you land on the demo, then check
   `https://your-subdomain/admin.php?token=<your admin_token>` to see it
   listed.

## Viewing captured leads

```
https://your-subdomain/admin.php?token=<admin_token from config.php>
```

Add `&export=csv` to download everything as a CSV instead.

## Security notes

- All database queries use PDO prepared statements (no string-built SQL).
- All lead-submitted content is HTML-escaped on the way out in `admin.php` -
  a lead putting `<script>` in their name or company doesn't execute it.
- A hidden honeypot field plus a per-IP fixed-window rate limit (5
  submissions/hour) on `submit-lead.php` blunts basic bot/scripted abuse
  without adding a CAPTCHA. If spam becomes a real problem, the next step up
  is Cloudflare Turnstile on the form - not built here to keep friction at
  zero for real visitors until there's evidence it's needed.
- `admin.php` is gated by a shared secret, not a full login system - treat
  the URL with the token like a password; don't post it anywhere public.

## Local testing

Needs PHP with the `pdo_mysql` extension and a MySQL/MariaDB server.

```
php -S 127.0.0.1:8899 -t public
```

Point `config.php`'s `db` block at any local MySQL/MariaDB instance with
`schema.sql` imported, then visit `http://127.0.0.1:8899/`.
