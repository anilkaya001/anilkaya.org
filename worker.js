/* =============================================================
   worker.js — Cloudflare Worker (Static Assets + API).
   Serves the static site via the ASSETS binding and handles the
   dynamic routes (/auth/*, /api/*) with D1-backed Google sign-in.
   Replaces the Pages functions/ directory.
   ============================================================= */
import { signSession, verifySession, getCookie, cookie } from "./shared/session.js";

// --- Content Security Policy ---------------------------------------------
// Strict by default. Pyodide (the in-browser Python runtime) is loaded from
// jsDelivr and needs eval/wasm; everything else is same-origin. No inline
// scripts exist in the site, so script-src omits 'unsafe-inline'.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' https://cdn.jsdelivr.net",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
};

// --- Per-topic social preview cards --------------------------------------
// The course player is one static page (/lab/course.html) that reads ?m= in
// JavaScript, so a shared link to any topic would show the same generic card
// to social crawlers (they don't run JS). For crawler user-agents only, we
// rewrite the og/twitter tags to the topic's own 1200x630 card. Human
// requests never enter this path — they get the untouched static asset.
const OG_TOPICS = {
  ols:    { title: "Ordinary Least Squares — Econometrics Lab",        desc: "The line of best fit, how it's computed, inference, and the assumptions behind it.", img: "/assets/img/og-ols.png" },
  iv2sls: { title: "Instrumental Variables & 2SLS — Econometrics Lab", desc: "When OLS is biased by endogeneity, and how an instrument plus 2SLS rescues it.",         img: "/assets/img/og-iv2sls.png" },
  did:    { title: "Difference-in-Differences — Econometrics Lab",     desc: "Treatment effects from before/after × treated/control, parallel trends, event studies.", img: "/assets/img/og-did.png" },
  var:    { title: "Vector Autoregression — Econometrics Lab",         desc: "Joint dynamics of several series: estimation, impulse responses, Granger causality.",     img: "/assets/img/og-var.png" },
  panel:  { title: "Panel: Fixed & Random Effects — Econometrics Lab", desc: "Unobserved heterogeneity, pooled-OLS bias, the within estimator, FE vs RE.",             img: "/assets/img/og-panel.png" },
  logit:  { title: "Logit & Probit — Econometrics Lab",                desc: "Binary outcomes: the logistic model, odds ratios, marginal effects, classification.",   img: "/assets/img/og-logit.png" },
  gmm:    { title: "Generalized Method of Moments — Econometrics Lab", desc: "Moment conditions as a unifying estimator, IV-GMM, over-identification, efficiency.",     img: "/assets/img/og-gmm.png" },
};

const CRAWLER = /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|slack-imgproxy|whatsapp|telegrambot|discordbot|pinterest|redditbot|applebot|googlebot|bingbot|embedly|iframely|vkshare|skypeuripreview|nuzzel|flipboard|tumblr|mastodon|w3c_validator/i;

const setAttr = (name, value) => ({ element: (el) => el.setAttribute(name, value) });

// Re-emit a (possibly immutable) response with the security headers applied.
// IMPORTANT: must use new Response(body, response) — rebuilding from an init
// dict corrupts the runtime's Content-Encoding handling on the edge and
// browsers then fail to decode CSS/JS (ERR_CONTENT_DECODING_FAILED).
function secure(resp) {
  const out = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  // CSP only matters on documents; keep asset payload headers lean.
  const ct = out.headers.get("Content-Type") || "";
  if (!ct.includes("text/html")) out.headers.delete("Content-Security-Policy");
  return out;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" },
  });

async function currentUser(request, env) {
  const token = getCookie(request, "session");
  if (token && env.SESSION_SECRET) {
    const p = await verifySession(token, env.SESSION_SECRET);
    if (p) return { id: p.sub, email: p.email, name: p.name };
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = url.origin;

    // --- Start Google OAuth ---
    if (path === "/auth/google") {
      const state = crypto.randomUUID();
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: origin + "/auth/callback",
        response_type: "code",
        scope: "openid email profile",
        state,
        access_type: "online",
        prompt: "select_account",
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString(),
          "Set-Cookie": cookie("oauth_state", state, { maxAge: 600 }),
        },
      });
    }

    // --- OAuth callback ---
    if (path === "/auth/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const saved = getCookie(request, "oauth_state");
      if (!code || !state || state !== saved) return Response.redirect(origin + "/lab/?auth=error", 302);

      const tok = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: origin + "/auth/callback",
          grant_type: "authorization_code",
        }),
      }).then((r) => r.json()).catch(() => ({}));
      if (!tok.access_token) return Response.redirect(origin + "/lab/?auth=error", 302);

      const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + tok.access_token },
      }).then((r) => r.json()).catch(() => ({}));
      if (!info.sub) return Response.redirect(origin + "/lab/?auth=error", 302);

      const user = { sub: "g_" + info.sub, email: info.email || "", name: info.name || info.email || "Learner" };
      if (env.DB) {
        await env.DB.prepare(
          "INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name"
        ).bind(user.sub, user.email, user.name, Date.now()).run();
      }
      const session = await signSession(
        { sub: user.sub, email: user.email, name: user.name, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 },
        env.SESSION_SECRET
      );
      const headers = new Headers({ Location: origin + "/lab/?auth=ok" });
      headers.append("Set-Cookie", cookie("session", session, { maxAge: 60 * 60 * 24 * 30 }));
      headers.append("Set-Cookie", cookie("oauth_state", "", { maxAge: 0 }));
      return new Response(null, { status: 302, headers });
    }

    // --- Logout ---
    if (path === "/auth/logout") {
      return new Response(null, {
        status: 302,
        headers: { Location: origin + "/lab/", "Set-Cookie": cookie("session", "", { maxAge: 0 }) },
      });
    }

    // --- Who am I ---
    if (path === "/api/me") {
      return json({ user: await currentUser(request, env) });
    }

    // --- Progress ---
    if (path === "/api/progress") {
      const user = await currentUser(request, env);
      if (!user) return new Response("Unauthorized", { status: 401 });

      if (request.method === "GET") {
        const progress = {};
        if (env.DB) {
          const rows = await env.DB.prepare("SELECT model_id, done_json FROM progress WHERE user_id = ?").bind(user.id).all();
          for (const r of rows.results || []) {
            try { progress[r.model_id] = { done: JSON.parse(r.done_json || "[]") }; } catch { /* skip */ }
          }
        }
        return json({ progress });
      }
      if (request.method === "PUT") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body.model !== "string" || !Array.isArray(body.done)) return new Response("Bad request", { status: 400 });
        if (env.DB) {
          await env.DB.prepare(
            "INSERT INTO progress (user_id, model_id, done_json, updated_at) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(user_id, model_id) DO UPDATE SET done_json=excluded.done_json, updated_at=excluded.updated_at"
          ).bind(user.id, body.model, JSON.stringify(body.done), Date.now()).run();
        }
        return json({ ok: true });
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // --- Points & streak ---
    if (path === "/api/stats") {
      const user = await currentUser(request, env);
      if (!user) return new Response("Unauthorized", { status: 401 });
      if (request.method === "GET") {
        let stats = { points: 0, streak: 0, last: null };
        if (env.DB) {
          const row = await env.DB.prepare("SELECT points, streak, last FROM stats WHERE user_id = ?").bind(user.id).first();
          if (row) stats = { points: row.points || 0, streak: row.streak || 0, last: row.last || null };
        }
        return json({ stats });
      }
      if (request.method === "PUT") {
        const b = await request.json().catch(() => null);
        if (!b) return new Response("Bad request", { status: 400 });
        if (env.DB) {
          await env.DB.prepare(
            "INSERT INTO stats (user_id, points, streak, last, updated_at) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT(user_id) DO UPDATE SET points=excluded.points, streak=excluded.streak, last=excluded.last, updated_at=excluded.updated_at"
          ).bind(user.id, b.points | 0, b.streak | 0, b.last || null, Date.now()).run();
        }
        return json({ ok: true });
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // --- Per-topic social preview card (crawlers only; humans untouched) ---
    if (path === "/lab/course.html") {
      const meta = OG_TOPICS[url.searchParams.get("m")];
      if (meta && CRAWLER.test(request.headers.get("User-Agent") || "")) {
        // Fetch uncompressed so HTMLRewriter can parse the HTML; it streams the
        // body through without a Content-Encoding header, so the edge is free to
        // (re)compress cleanly for the crawler.
        const asset = await env.ASSETS.fetch(
          new Request(origin + "/lab/course.html", { headers: { "Accept-Encoding": "identity" } })
        );
        if ((asset.headers.get("Content-Type") || "").includes("text/html")) {
          const img = origin + meta.img;
          const rewritten = new HTMLRewriter()
            .on("title", { element: (el) => el.setInnerContent(meta.title) })
            .on('meta[property="og:title"]', setAttr("content", meta.title))
            .on('meta[property="og:description"]', setAttr("content", meta.desc))
            .on('meta[property="og:image"]', setAttr("content", img))
            .on('meta[name="twitter:image"]', setAttr("content", img))
            .transform(asset);
          return secure(rewritten);
        }
        return secure(asset);
      }
    }

    // --- Everything else: static assets (index.html, /lab/, css, js, ...) ---
    const resp = secure(await env.ASSETS.fetch(request));
    const ct = resp.headers.get("Content-Type") || "";
    if (ct.includes("text/html")) {
      // Documents must revalidate every time (cheap: assets carry ETags, so
      // unchanged pages are 304s). Guarantees nobody keeps stale HTML that
      // points at old asset versions.
      resp.headers.set("Cache-Control", "no-cache");
      // One-time purge: browsers that visited during the Content-Encoding
      // incident hold corrupted cache entries for random assets and replay
      // them (styled topbar, dead grid). Clearing this origin's HTTP cache
      // once evicts them all; the cookie survives the purge, so each browser
      // pays a single cold load and never again.
      if (!getCookie(request, "cachefix")) {
        resp.headers.set("Clear-Site-Data", '"cache"');
        resp.headers.append("Set-Cookie", cookie("cachefix", "1", { maxAge: 60 * 60 * 24 * 365 }));
      }
    } else if (url.searchParams.has("v")) {
      // Versioned subresources never change under a given ?v — cache hard.
      resp.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if (ct && !ct.includes("application/json")) {
      resp.headers.set("Cache-Control", "public, max-age=3600");
    }
    return resp;
  },
};
