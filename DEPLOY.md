# Deploy — Phase 2 (Cloudflare Pages + D1 + Google sign-in)

The site runs fine today on **GitHub Pages** (static, on-device progress). To turn
on **Google accounts + cross-device progress**, deploy this same repo to
**Cloudflare Pages**, which runs the `functions/` and binds the `D1` database.
None of this can be done from the agent sandbox — it needs your Cloudflare and
Google accounts. Steps:

## 1. D1 database — ✅ already done
The database **`iewt`** is already created on your Cloudflare account and the
schema (`users`, `progress`) is applied. Its id is already in `wrangler.toml`:
`73c8c626-e971-44da-b8c1-21d6062cb9f2`. Nothing to do here.

> To recreate from scratch: `wrangler d1 create iewt` then
> `wrangler d1 execute iewt --remote --file=./schema.sql`.

## 2. Create the Pages project (Git integration = automatic deploys)
- Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
- Pick `anilkaya001/anilkaya.org`, production branch **main**.
- Build command: **(none)**. Build output directory: **`/`**.
- Every push to `main` now deploys production; every branch/PR gets its own
  **preview deployment** in parallel.
- **Settings → Functions → D1 database bindings:** add `DB` → `iewt`.

## 3. Google OAuth client
- Google Cloud Console → **APIs & Services → Credentials → Create OAuth client
  ID → Web application**.
- Authorized redirect URIs:
  - `https://anilkaya.org/auth/callback`
  - (optional, for previews) `https://<project>.pages.dev/auth/callback`
- Copy the **Client ID** and **Client secret**.

## 4. Set environment variables (Pages → Settings → Environment variables)
| Name | Value |
|------|-------|
| `GOOGLE_CLIENT_ID` | from step 3 |
| `GOOGLE_CLIENT_SECRET` | from step 3 (mark **encrypted**) |
| `SESSION_SECRET` | any long random string (mark **encrypted**) |
| `BASE_URL` | `https://anilkaya.org` |

## 5. Move the domain to Pages
In the Pages project → **Custom domains → Set up a domain → `anilkaya.org`**.
Because the zone is already on Cloudflare, DNS updates automatically (this
supersedes the GitHub Pages A records). Add `www` if you want it too.

## 6. Verify
Open `https://anilkaya.org/lab/`, click **Sign in** → Google → you return signed
in; finishing a lesson step writes to D1 and syncs across devices.

---

### Local development
```bash
echo 'GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=dev-secret
BASE_URL=http://localhost:8788' > .dev.vars       # git-ignored
wrangler pages dev . --d1 DB=iewt
```

### Notes
- `functions/`, `wrangler.toml`, `schema.sql`, `shared/` are inert on GitHub
  Pages — they only activate on Cloudflare Pages. The frontend (`auth.js`)
  auto-detects the backend, so nothing breaks in the meantime.
- Sessions are stateless signed cookies (HMAC), so no session store is needed.
