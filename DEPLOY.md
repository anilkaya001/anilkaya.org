# Deploy — Phase 2 (Cloudflare Worker + D1 + Google sign-in)

The site runs on **GitHub Pages** today (static, on-device progress). To turn on
**Google accounts + cross-device progress**, deploy this repo as a **Cloudflare
Worker with Static Assets** (`worker.js` serves the site via the `ASSETS`
binding and handles `/auth/*` + `/api/*`, backed by D1). GitHub Pages keeps
working untouched until you move the domain in the last step.

## 1. D1 database — ✅ already done
Database **`iewt`** is created on your Cloudflare account and migrated
(`users`, `progress`). Its id is already in `wrangler.toml`
(`73c8c626-e971-44da-b8c1-21d6062cb9f2`). The `[[d1_databases]]` binding is
applied automatically by `wrangler deploy`.

## 2. Create the Worker (Git-connected)
- **Workers & Pages → Create → Workers → Connect to Git** (or *Import a
  repository*) → select `anilkaya001/anilkaya.org`.
- **Worker name:** `anilkaya-org` (must match `name` in `wrangler.toml`).
- **Build command:** *(empty)*  ·  **Deploy command:** `npx wrangler deploy`
  ·  **Root directory:** `/`
- **Save and Deploy.** First deploy publishes the site + Worker to a
  `*.workers.dev` URL. (Sign-in won't work yet — no Google keys.)

## 3. Google OAuth client
- Google Cloud Console → **APIs & Services → Credentials → Create OAuth client
  ID → Web application**.
- **Authorized redirect URIs** (add both):
  - `https://<your-worker>.workers.dev/auth/callback`
  - `https://anilkaya.org/auth/callback`
- Copy the **Client ID** and **Client secret**.

## 4. Add secrets (Worker → Settings → Variables and Secrets)
| Name | Type | Value |
|------|------|-------|
| `GOOGLE_CLIENT_ID` | Plaintext | from step 3 |
| `GOOGLE_CLIENT_SECRET` | **Secret** | from step 3 |
| `SESSION_SECRET` | **Secret** | a long random string |

Then **Deploy** again (or wait for the next push) so the Worker picks them up.

## 5. Test on the workers.dev URL
Open `https://<your-worker>.workers.dev/lab/` → **Sign in** → Google → you land
back signed in. A row appears in the D1 `users` table.

## 6. Move the domain (last step, switches off GitHub Pages)
Worker → **Settings → Domains & Routes → Add → Custom domain → `anilkaya.org`**
(add `www` too if you like). Cloudflare updates DNS automatically — this
supersedes the GitHub Pages A records, so `anilkaya.org` now serves from the
Worker with sign-in live.

---

### Local dev
```bash
echo 'GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=dev-secret' > .dev.vars     # git-ignored
npx wrangler dev
```

### Notes
- `worker.js`, `wrangler.toml`, `shared/`, `schema.sql`, `.assetsignore` are
  inert on GitHub Pages — they only matter on Cloudflare. `auth.js` auto-detects
  the backend and falls back to on-device when absent, so nothing breaks
  in the meantime.
- Sessions are stateless signed cookies (HMAC) — no session store needed.
