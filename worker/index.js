// Cloudflare Worker entrypoint for the Waika Studios site and onboarding form.
const ALLOWED_ORIGINS = new Set([
  "https://waikastudios.waikastudios.chatgpt.site"
]);

const MAX_BODY_BYTES = 64 * 1024;
const CHALLENGE_MIN_AGE_MS = 2_500;
const CHALLENGE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_SUBMISSIONS = 5;
const rateLimits = new Map();
const REQUIRED_FIELDS = [
  "name", "email", "Proyecto", "Negocio", "Audiencia", "Objetivo",
  "Resultado_esperado", "Imprescindible", "Secciones", "Materiales"
];
const FIELD_LIMITS = {
  name: 120,
  email: 254,
  Proyecto: 180,
  Negocio: 3000,
  Audiencia: 2000,
  Objetivo: 80,
  Resultado_esperado: 2000,
  Necesidades: 500,
  Imprescindible: 2000,
  Secciones: 2000,
  Materiales: 2000,
  Referencias: 2000,
  Notas_visuales: 2000,
  Timing: 1000,
  Consentimiento: 8,
  Origen: 500
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'sha256-ZCp7Ap07DRWgrGxPiQByI7DU+6Xm/VuIjv/xGXOqeK0='",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self'",
  "connect-src 'self'",
  "upgrade-insecure-requests"
].join("; ");

function applySecurityHeaders(response, pathname = "") {
  const secured = new Response(response.body, response);
  secured.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  secured.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  secured.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  secured.headers.delete("Server");
  if (pathname.startsWith("/api/")) secured.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (pathname === "/onboarding.html" || pathname === "/onboarding") {
    secured.headers.set("X-Robots-Tag", "noindex, follow, noarchive");
  }
  return secured;
}

function json(body, status = 200, extraHeaders = {}) {
  return applySecurityHeaders(new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  }), "/api/");
}

function clean(value, maxLength = 4000) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br>");
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function allowedPageRequest(request) {
  const origin = request.headers.get("Origin");
  if (origin) return ALLOWED_ORIGINS.has(origin);
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return ALLOWED_ORIGINS.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function hmac(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function createChallenge(env) {
  if (!env.FORM_SIGNING_SECRET) return json({ message: "Protección del formulario no configurada." }, 503);
  const issuedAt = Date.now();
  const nonce = crypto.randomUUID();
  const payload = `${issuedAt}.${nonce}`;
  const signature = await hmac(payload, env.FORM_SIGNING_SECRET);
  return json({
    token: `${payload}.${signature}`,
    issuedAt,
    minWaitMs: CHALLENGE_MIN_AGE_MS,
    expiresAt: issuedAt + CHALLENGE_MAX_AGE_MS
  });
}

async function validChallenge(token, env) {
  if (!env.FORM_SIGNING_SECRET || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [issuedAtRaw, nonce, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  const age = Date.now() - issuedAt;
  if (!Number.isFinite(issuedAt) || !/^[0-9a-f-]{36}$/i.test(nonce)) return false;
  if (age < CHALLENGE_MIN_AGE_MS || age > CHALLENGE_MAX_AGE_MS) return false;
  const expected = await hmac(`${issuedAtRaw}.${nonce}`, env.FORM_SIGNING_SECRET);
  return safeEqual(signature, expected);
}

function withinRateLimit(request) {
  const client = request.headers.get("CF-Connecting-IP");
  if (!client) return true;
  const now = Date.now();
  const current = rateLimits.get(client);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateLimits.set(client, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (rateLimits.size > 1000) {
    for (const [key, value] of rateLimits) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateLimits.delete(key);
    }
  }
  return current.count <= RATE_MAX_SUBMISSIONS;
}

function emailHtml(fields) {
  const rows = [
    ["Nombre", fields.name], ["Email", fields.email], ["Proyecto", fields.Proyecto],
    ["Negocio", fields.Negocio], ["Audiencia", fields.Audiencia], ["Objetivo", fields.Objetivo],
    ["Resultado esperado", fields.Resultado_esperado], ["Necesidades", fields.Necesidades],
    ["Imprescindible", fields.Imprescindible], ["Secciones", fields.Secciones],
    ["Materiales", fields.Materiales], ["Referencias", fields.Referencias],
    ["Notas visuales", fields.Notas_visuales], ["Timing", fields.Timing],
    ["Consentimiento", fields.Consentimiento], ["Origen", fields.Origen]
  ];

  return `<!doctype html><html><body style="margin:0;background:#f4f4f1;color:#16221c;font-family:Arial,sans-serif">
    <div style="max-width:720px;margin:0 auto;padding:32px 20px">
      <h1 style="font-size:28px;margin:0 0 8px">Nuevo briefing de ${escapeHtml(fields.name)}</h1>
      <p style="margin:0 0 24px;color:#526159">Proyecto: <strong>${escapeHtml(fields.Proyecto)}</strong></p>
      <table role="presentation" style="width:100%;border-collapse:collapse;background:#fff">
        ${rows.map(([label, value]) => `<tr><th style="width:180px;padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid #e2e6e3">${escapeHtml(label)}</th><td style="padding:12px;border-bottom:1px solid #e2e6e3">${escapeHtml(value || "No indicado")}</td></tr>`).join("")}
      </table>
    </div>
  </body></html>`;
}

function confirmationEmailHtml(fields) {
  const firstName = clean(fields.name, 120).split(/\s+/)[0] || "Hola";

  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f1;color:#0d100e;font-family:Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:40px 20px">
      <div style="background:#0d100e;padding:18px 22px;color:#9bdc28;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Waika Studios</div>
      <div style="background:#ffffff;padding:36px 28px;border:1px solid #dfe4df">
        <p style="margin:0 0 14px;font-size:16px">Hola, ${escapeHtml(firstName)}.</p>
        <h1 style="margin:0 0 18px;font-size:30px;line-height:1.08;letter-spacing:-.03em">Hemos recibido tu briefing.</h1>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#39433d">Gracias por compartirnos la información de <strong>${escapeHtml(fields.Proyecto)}</strong>. Ya estamos revisando tus objetivos, necesidades y el alcance del proyecto.</p>
        <p style="margin:0 0 26px;font-size:16px;line-height:1.65;color:#39433d">Nos pondremos en contacto contigo lo antes posible con los siguientes pasos y una propuesta pensada para tu proyecto.</p>
        <div style="padding:18px 20px;background:#eff7e3;border-left:4px solid #79b900">
          <p style="margin:0;font-size:14px;line-height:1.55">Si quieres añadir algún detalle, puedes responder directamente a este correo.</p>
        </div>
        <p style="margin:28px 0 0;font-size:15px;line-height:1.5"><strong>Waika Studios</strong><br><span style="color:#66716a">Estrategia, diseño web e IA aplicada.</span></p>
      </div>
    </div>
  </body></html>`;
}

async function sendEmail(env, payload, idempotencyKey) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  return { response, result };
}

async function handleBriefing(request, env) {
  if (!allowedPageRequest(request)) return json({ success: false, message: "Origen no permitido." }, 403);
  if (!env.RESEND_API_KEY) return json({ success: false, message: "El servicio de correo no está configurado." }, 503);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return json({ success: false, message: "Tipo de contenido no permitido." }, 415);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ success: false, message: "La solicitud es demasiado grande." }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "Solicitud no válida." }, 400);
  }

  if (clean(body.website, 200)) return json({ success: true });
  if (!(await validChallenge(body.formChallenge, env))) {
    return json({ success: false, message: "La validación del formulario ha caducado. Recarga la página." }, 403);
  }
  if (!withinRateLimit(request)) {
    return json({ success: false, message: "Demasiados envíos. Inténtalo de nuevo más tarde." }, 429, { "Retry-After": "3600" });
  }

  const fields = {};
  for (const [key, maxLength] of Object.entries(FIELD_LIMITS)) fields[key] = clean(body[key], maxLength);
  const missing = REQUIRED_FIELDS.find((key) => !fields[key]);
  if (missing || !validEmail(fields.email) || fields.Consentimiento !== "Sí") {
    return json({ success: false, message: "Faltan datos obligatorios o el correo no es válido." }, 400);
  }

  fields.Proyecto = fields.Proyecto.replace(/[\r\n]+/g, " ");
  const idempotencySource = `${fields.email}|${fields.Proyecto}|${fields.Origen}|${new Date().toISOString().slice(0, 10)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(idempotencySource));
  const idempotencyKey = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  const from = clean(env.BRIEFING_FROM_EMAIL, 320) || "Waika Studios <onboarding@resend.dev>";
  const replyTo = clean(env.BRIEFING_REPLY_TO, 254) || "waikastudios@gmail.com";
  const briefingDelivery = await sendEmail(env, {
    from,
    to: ["waikastudios@gmail.com"],
    reply_to: fields.email,
    subject: `Nuevo briefing: ${fields.Proyecto}`.slice(0, 180),
    html: emailHtml(fields)
  }, `waika-briefing-${idempotencyKey}`);

  if (!briefingDelivery.response.ok || !briefingDelivery.result.id) {
    console.error("Resend rejected briefing", briefingDelivery.response.status, briefingDelivery.result);
    return json({ success: false, message: "El correo no pudo entregarse. Inténtalo de nuevo en unos minutos." }, 502);
  }

  const confirmationDelivery = await sendEmail(env, {
    from,
    to: [fields.email],
    reply_to: replyTo,
    subject: "Hemos recibido tu briefing — Waika Studios",
    html: confirmationEmailHtml(fields)
  }, `waika-confirmation-${idempotencyKey}`);
  const confirmationSent = confirmationDelivery.response.ok && Boolean(confirmationDelivery.result.id);

  if (!confirmationSent) {
    console.error("Resend rejected briefing confirmation", confirmationDelivery.response.status, confirmationDelivery.result);
  }

  return json({
    success: true,
    deliveryId: briefingDelivery.result.id,
    confirmationSent
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/form-challenge") {
      if (request.method !== "GET") return json({ success: false, message: "Método no permitido." }, 405, { Allow: "GET" });
      if (!allowedPageRequest(request)) return json({ success: false, message: "Origen no permitido." }, 403);
      return createChallenge(env);
    }
    if (url.pathname === "/api/briefing") {
      if (request.method !== "POST") return json({ success: false, message: "Método no permitido." }, 405, { Allow: "POST" });
      return handleBriefing(request, env);
    }
    const response = await env.ASSETS.fetch(request);
    return applySecurityHeaders(response, url.pathname);
  }
};
