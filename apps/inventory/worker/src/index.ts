/**
 * 777 Inventory — Cloudflare Worker (scaffold).
 *
 * What is REAL here:
 *   - The login gate. Single user; credentials come from Worker secrets
 *     APP_USERNAME / APP_PASSWORD_HASH (hex SHA-256 of the password).
 *     A successful login sets an HttpOnly session cookie carrying an
 *     HMAC-signed, expiring token. Every /api/* route rejects
 *     unauthenticated requests with 401.
 *   - GET /api/health.
 *   - A minimal placeholder app shell behind the same gate.
 *
 * What is STUBBED:
 *   - Every other /api/* endpoint returns a contract-shaped mock (GETs,
 *     200) or 501 (mutations), each body marked "stub": true with a TODO.
 *     Shapes follow docs/API_CONTRACTS.md — the AI Studio UI is built
 *     against those contracts with its own mocks, and these handlers get
 *     wired to D1/R2 + the core engine logic in later phases.
 *
 * Secrets are NEVER in code. Local dev: worker/.dev.vars (see
 * .dev.vars.example). Production: `wrangler secret put …`.
 */

export interface Env {
  APP_USERNAME: string;
  APP_PASSWORD_HASH: string; // hex SHA-256 of the password
  APP_ENV?: string;
  // TODO(phase-2): DB: D1Database; ASSETS: R2Bucket; GEMINI_API_KEY: string;
}

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

// ---------------------------------------------------------------------------
// Crypto helpers (WebCrypto; no dependencies)
// ---------------------------------------------------------------------------

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return toHex(sig);
}

/** Constant-time string comparison (lengths are not secret here). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Sessions: token = b64url(payload) "." hmac_hex(payload), payload = "user|exp"
// The HMAC key is the password hash secret itself — single-user scaffold;
// rotating the password secret invalidates all sessions, which is desired.
// ---------------------------------------------------------------------------

async function issueSession(env: Env): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${env.APP_USERNAME}|${exp}`;
  const sig = await hmacHex(env.APP_PASSWORD_HASH, payload);
  return `${b64urlEncode(payload)}.${sig}`;
}

async function verifySession(env: Env, token: string | null): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  let payload: string;
  try {
    payload = b64urlDecode(token.slice(0, dot));
  } catch {
    return false;
  }
  const expected = await hmacHex(env.APP_PASSWORD_HASH, payload);
  if (!safeEqual(expected, token.slice(dot + 1))) return false;
  const [user, expRaw] = payload.split("|");
  const exp = Number(expRaw);
  return user === env.APP_USERNAME && Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

function sessionFromRequest(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function unauthorized(): Response {
  return json({ error: "unauthorized", message: "Login required." }, 401);
}

/** Stub marker: every not-yet-implemented handler returns through here. */
function stub(body: Record<string, unknown>, status = 200): Response {
  return json({ stub: true, todo: "Not implemented yet — see docs/API_CONTRACTS.md.", ...body }, status);
}

function notImplemented(what: string): Response {
  return stub({ error: "not_implemented", message: `${what} is not implemented yet.` }, 501);
}

// ---------------------------------------------------------------------------
// HTML shell (placeholder until the AI Studio UI lands)
// ---------------------------------------------------------------------------

const LOGIN_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>777 Inventory — Login</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111827}
form{background:#fff;padding:2rem;border-radius:8px;width:300px}label{display:block;margin:.75rem 0 .25rem;font-size:.85rem}
input{width:100%;padding:.5rem;box-sizing:border-box}button{margin-top:1rem;width:100%;padding:.6rem;background:#1F4E79;color:#fff;border:0;border-radius:4px;cursor:pointer}
.err{color:#b91c1c;font-size:.85rem;min-height:1em}</style></head>
<body><form id="f"><h2>777 Inventory</h2><div class="err" id="e"></div>
<label>Username</label><input name="username" autocomplete="username" required>
<label>Password</label><input name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in</button></form>
<script>document.getElementById('f').addEventListener('submit',async(ev)=>{ev.preventDefault();
const fd=new FormData(ev.target);const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:fd.get('username'),password:fd.get('password')})});
if(r.ok){location.href='/';}else{document.getElementById('e').textContent='Invalid username or password.';}});</script>
</body></html>`;

const SHELL_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>777 Inventory</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#111827}code{background:#f3f4f6;padding:.1rem .3rem;border-radius:4px}</style></head>
<body><h1>777 Inventory</h1>
<p>Worker scaffold is live and you are signed in. The full UI is built in
Google AI Studio against <code>docs/API_CONTRACTS.md</code> and will be
served here.</p>
<p>API stubs are under <code>/api/*</code> (try <code>/api/items</code>).
<form method="POST" action="/logout"><button type="submit">Sign out</button></form></p>
</body></html>`;

// ---------------------------------------------------------------------------
// API stubs — contract-shaped, per docs/API_CONTRACTS.md
// ---------------------------------------------------------------------------

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method.toUpperCase();

  if (path === "/api/health") {
    return json({ ok: true, service: "777-inventory", version: "0.1.0" });
  }

  // Everything below requires auth.
  if (!(await verifySession(env, sessionFromRequest(request)))) return unauthorized();

  // -- Import -------------------------------------------------------------
  if (path === "/api/import" && method === "POST") return notImplemented("POST /api/import");
  if (/^\/api\/import\/[^/]+\/commit$/.test(path) && method === "POST") {
    return notImplemented("POST /api/import/:id/commit");
  }

  // -- Enrichment jobs ------------------------------------------------------
  if (path === "/api/enrich" && method === "POST") return notImplemented("POST /api/enrich");
  if (/^\/api\/enrich\/[^/]+$/.test(path) && method === "GET") {
    return stub({ job_id: path.split("/").pop(), status: "queued", progress: 0, results: {}, updates: [] });
  }

  // -- Items ------------------------------------------------------------------
  if (path === "/api/items" && method === "GET") {
    return stub({ items: [], total: 0, page: 1, page_size: 50 });
  }
  if (/^\/api\/items\/[^/]+$/.test(path) && method === "PATCH") {
    return notImplemented("PATCH /api/items/:id");
  }

  // -- Pricing ------------------------------------------------------------------
  if (path === "/api/pricing/suggestions" && method === "GET") {
    return stub({
      items: [],
      summary: { suggestions: 0, blocked: 0, total_current: 0, total_if_all_applied: 0, total_if_unflagged_applied: 0 },
    });
  }
  if (path === "/api/pricing/apply" && method === "POST") return notImplemented("POST /api/pricing/apply");

  // -- Exports / push -------------------------------------------------------------
  if (path === "/api/export/toast" && method === "POST") return notImplemented("POST /api/export/toast");
  if (path === "/api/push/cooler-door" && method === "POST") return notImplemented("POST /api/push/cooler-door");

  // -- Analytics --------------------------------------------------------------------
  if (path === "/api/analytics/overview" && method === "GET") {
    return stub({ period: "last_30d", net_sales: 0, orders: 0, top_categories: [], top_items: [] });
  }
  if (/^\/api\/analytics\/items\/[^/]+$/.test(path) && method === "GET") {
    return stub({ item_id: path.split("/").pop(), units_sold_30d: 0, revenue_30d: 0, margin_pct: null, trend: "flat", suggested_action: null });
  }
  if (path === "/api/analytics/suggestions" && method === "GET") {
    return stub({ price_suggestions: [], new_products: [] });
  }

  // -- Labels -------------------------------------------------------------------------
  if (path === "/api/label-templates/builtins" && method === "GET") {
    return stub({
      items: [
        { key: "5160", name: 'Avery 5160 — 1" × 2-5/8"', per_sheet: 30 },
        { key: "8160", name: 'Avery 8160 — 1" × 2-5/8"', per_sheet: 30 },
        { key: "5161", name: 'Avery 5161 — 1" × 4"', per_sheet: 20 },
        { key: "5163", name: 'Avery 5163 — 2" × 4"', per_sheet: 10 },
        { key: "5164", name: 'Avery 5164 — 3-1/3" × 4"', per_sheet: 6 },
        { key: "5167", name: 'Avery 5167 — 1/2" × 1-3/4"', per_sheet: 80 },
      ],
    });
  }
  if (path === "/api/label-templates" && method === "GET") return stub({ items: [] });
  if (path === "/api/label-templates" && method === "POST") return notImplemented("POST /api/label-templates");
  if (/^\/api\/label-templates\/[^/]+$/.test(path)) return notImplemented("label template item route");
  if (path === "/api/labels/render" && method === "POST") return notImplemented("POST /api/labels/render");

  return json({ error: "not_found", message: `No route for ${method} ${path}` }, 404);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (path.startsWith("/api/")) return handleApi(request, env, path);

    if (path === "/login" && method === "POST") {
      let username = "";
      let password = "";
      const contentType = request.headers.get("Content-Type") ?? "";
      try {
        if (contentType.includes("application/json")) {
          const body = (await request.json()) as { username?: string; password?: string };
          username = body.username ?? "";
          password = body.password ?? "";
        } else {
          const form = await request.formData();
          username = String(form.get("username") ?? "");
          password = String(form.get("password") ?? "");
        }
      } catch {
        return json({ error: "bad_request", message: "Could not parse login body." }, 400);
      }
      const passwordHash = await sha256Hex(password);
      const ok =
        safeEqual(username, env.APP_USERNAME ?? "") &&
        safeEqual(passwordHash, (env.APP_PASSWORD_HASH ?? "").toLowerCase());
      if (!ok) return json({ error: "invalid_credentials", message: "Invalid username or password." }, 401);
      const token = await issueSession(env);
      return json({ ok: true }, 200, {
        "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
      });
    }

    if (path === "/logout" && method === "POST") {
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/",
          "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
        },
      });
    }

    // App shell: login page is the only public page.
    if (await verifySession(env, sessionFromRequest(request))) {
      return new Response(SHELL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response(LOGIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
};
