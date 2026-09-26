// Cloudflare Worker entrypoint for the Waika Studios site and onboarding form.
const DEFAULT_ORIGIN = "https://waikastudios.waikastudios.chatgpt.site";
const PRODUCTION_ORIGIN = "https://waikastudios.com";
const PRODUCTION_HOSTS = new Set(["waikastudios.com", "www.waikastudios.com"]);

const MAX_BODY_BYTES = 64 * 1024;
const CHALLENGE_MIN_AGE_MS = 2_500;
const CHALLENGE_MAX_AGE_MS = 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const rateLimits = new Map();
const usedChallenges = new Map();
const inFlightSubmissions = new Map();
const completedSubmissions = new Map();
const CLEAN_ROUTES = new Map([
  ["/onboarding", "/onboarding.html"], ["/planes", "/planes.html"], ["/trabajos", "/trabajos.html"],
  ["/aplicaciones", "/aplicaciones.html"], ["/preguntas", "/preguntas.html"],
  ["/privacidad", "/privacidad.html"], ["/cookies", "/cookies.html"],
  ["/terminos", "/terminos.html"]
]);
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
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "upgrade-insecure-requests"
].join("; ");

function applySecurityHeaders(response, pathname = "", { noindex = false } = {}) {
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
  if (noindex) secured.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (pathname === "/404.html" || response.status === 404) secured.headers.set("X-Robots-Tag", "noindex, follow");
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

function requestLocale(request) {
  return /^en(?:[-,;]|$)/i.test(request.headers.get("Accept-Language")?.trim() || "") ? "en" : "es";
}

function apiMessage(request, spanish, english) {
  return requestLocale(request) === "en" ? english : spanish;
}

function methodNotAllowed(request, allow) {
  return json({ success: false, message: apiMessage(request, "Método no permitido.", "Method not allowed.") }, 405, { Allow: allow });
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function configuredPublicOrigin(env) {
  const value = clean(env.PUBLIC_SITE_ORIGIN, 250);
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname.endsWith(".localhost")
      || /^127(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname === "[::1]";
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function publicOrigin(env, request) {
  const configured = configuredPublicOrigin(env);
  if (configured) return configured;
  try {
    const url = new URL(request.url);
    if (url.protocol === "https:" && PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) return PRODUCTION_ORIGIN;
  } catch {}
  return DEFAULT_ORIGIN;
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname.endsWith(".localhost")
    || /^127(?:\.\d{1,3}){3}$/.test(hostname) || hostname === "[::1]";
}

function allowedPageRequest(request, env) {
  const allowedOrigin = publicOrigin(env, request);
  const origin = request.headers.get("Origin");
  if (origin) return origin === allowedOrigin;
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === allowedOrigin;
  } catch {
    return false;
  }
}

async function rewriteSeoOrigin(response, pathname, origin) {
  if (origin === DEFAULT_ORIGIN || response.status >= 400 || !response.body) return response;
  const contentType = response.headers.get("Content-Type") || "";
  const rewriteable = contentType.includes("text/html") || pathname === "/sitemap.xml" || pathname === "/robots.txt" || pathname === "/.well-known/security.txt";
  if (!rewriteable) return response;
  const body = await response.clone().text();
  if (!body.includes(DEFAULT_ORIGIN)) return response;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.delete("ETag");
  return new Response(body.replaceAll(DEFAULT_ORIGIN, origin), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
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

async function createChallenge(request, env) {
  if (!withinRateLimit(request)) return json({ message: apiMessage(request, "Demasiados intentos. Vuelve a probar en unos minutos.", "Too many attempts. Please try again in a few minutes.") }, 429, { "Retry-After": "900" });
  if (!env.FORM_SIGNING_SECRET) return json({ message: apiMessage(request, "Protección del formulario no configurada.", "Form protection is not configured.") }, 503);
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
  if (!safeEqual(signature, expected)) return false;
  return { nonce, issuedAt };
}

function consumeChallenge(challenge, idempotencyKey) {
  if (!challenge) return false;
  const previous = usedChallenges.get(challenge.nonce);
  if (previous) return previous.idempotencyKey === idempotencyKey;
  usedChallenges.set(challenge.nonce, { consumedAt: Date.now(), idempotencyKey });
  return true;
}

function withinRateLimit(request) {
  const client = clean(request.headers.get("CF-Connecting-IP"), 80)
    || clean(request.headers.get("X-Waika-Client-IP"), 80)
    || "unknown";
  const now = Date.now();
  const current = rateLimits.get(client);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateLimits.set(client, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (rateLimits.size > 1000 || usedChallenges.size > 2000) {
    for (const [key, value] of rateLimits) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateLimits.delete(key);
    }
    for (const [key, value] of usedChallenges) {
      if (now - value.consumedAt >= CHALLENGE_MAX_AGE_MS) usedChallenges.delete(key);
    }
  }
  return current.count <= 30;
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > maxBytes) throw new RangeError("Request body too large");
  if (!request.body) throw new SyntaxError("Request body is empty");

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RangeError("Request body too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function sendBriefingToMake(env, fields, idempotencyKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(env.MAKE_ONBOARDING_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waika-Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        ...fields,
        submissionId: idempotencyKey,
        submittedAt: new Date().toISOString()
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function handleBriefing(request, env) {
  if (!allowedPageRequest(request, env)) return json({ success: false, message: apiMessage(request, "Origen no permitido.", "Origin not allowed.") }, 403);
  if (!env.MAKE_ONBOARDING_WEBHOOK_URL) {
    return json({ success: false, message: apiMessage(request, "El servicio de recepción no está configurado.", "The briefing service is not configured.") }, 503);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return json({ success: false, message: apiMessage(request, "Tipo de contenido no permitido.", "Unsupported content type.") }, 415);
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RangeError) return json({ success: false, message: apiMessage(request, "La solicitud es demasiado grande.", "The request is too large.") }, 413);
    return json({ success: false, message: apiMessage(request, "Solicitud no válida.", "Invalid request.") }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ success: false, message: apiMessage(request, "Solicitud no válida.", "Invalid request.") }, 400);

  if (clean(body.website, 200)) return json({ success: true });
  if (!withinRateLimit(request)) {
    return json({ success: false, message: apiMessage(request, "Demasiados intentos. Inténtalo de nuevo más tarde.", "Too many attempts. Please try again later.") }, 429, { "Retry-After": "900" });
  }
  const challenge = await validChallenge(body.formChallenge, env);

  const fields = {};
  for (const [key, maxLength] of Object.entries(FIELD_LIMITS)) fields[key] = clean(body[key], maxLength);
  const missing = REQUIRED_FIELDS.find((key) => !fields[key]);
  if (missing || !validEmail(fields.email) || fields.Consentimiento !== "Sí") {
    return json({ success: false, message: apiMessage(request, "Faltan datos obligatorios o el correo no es válido.", "Required information is missing or the email address is invalid.") }, 400);
  }

  fields.Proyecto = fields.Proyecto.replace(/[\r\n]+/g, " ");
  const suppliedId = clean(body.submissionId, 80);
  const idempotencySource = /^[0-9a-f-]{36}$/i.test(suppliedId)
    ? suppliedId
    : `${fields.email}|${fields.Proyecto}|${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(idempotencySource));
  const idempotencyKey = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!consumeChallenge(challenge, idempotencyKey)) {
    return json({ success: false, message: apiMessage(request, "La validación del formulario ha caducado. Recarga la página.", "Form validation has expired. Reload the page and try again.") }, 403);
  }
  if (completedSubmissions.has(idempotencyKey)) return json({ success: true, webhookAccepted: true, duplicate: true });

  const deliveryJob = inFlightSubmissions.get(idempotencyKey) || (async () => {
    try {
      const response = await sendBriefingToMake(env, fields, idempotencyKey);
      if (!response.ok) {
        console.error("Make rejected briefing", { status: response.status });
        return { success: false, status: 502, message: apiMessage(request, "El briefing no pudo procesarse. Inténtalo de nuevo en unos minutos.", "We couldn't process the brief. Please try again in a few minutes.") };
      }
      return { success: true, status: 200, webhookAccepted: true };
    } catch (error) {
      console.error("Make delivery failed", { name: error?.name || "Error" });
      return { success: false, status: 502, message: apiMessage(request, "No pudimos enviar el briefing. Inténtalo de nuevo en unos minutos.", "We couldn't send the brief. Please try again in a few minutes.") };
    }
  })();
  inFlightSubmissions.set(idempotencyKey, deliveryJob);
  const delivery = await deliveryJob;
  inFlightSubmissions.delete(idempotencyKey);
  if (delivery.success) {
    completedSubmissions.set(idempotencyKey, Date.now());
    if (completedSubmissions.size > 1000) {
      for (const [key, timestamp] of completedSubmissions) {
        if (Date.now() - timestamp > 24 * 60 * 60 * 1000) completedSubmissions.delete(key);
      }
    }
  }
  return json(delivery, delivery.status);
}

const CHAT_SYSTEM = `Eres el asistente web de Waika Studios. Responde en el idioma indicado por el visitante, de forma breve, amable y concreta. Solo puedes afirmar estos datos: Waika diseña webs, contenido, herramientas digitales, aplicaciones, IA y automatizaciones; una landing interactiva sin administrador cuesta $250; una versión con administrador para editar el contenido acordado cuesta $350; la gestión de redes sociales empieza en $250; asesorías y paquetes de contenido aún no tienen tarifa publicada; apps y software a medida se cotizan después de estudiar el caso. Los impuestos aplicables y condiciones se confirman en la propuesta. Para landings, la primera versión se entrega en 24-48 horas laborables cuando el pago, briefing y materiales necesarios están completos; si se incumple ese plazo, se devuelve el 50% según esas condiciones. No prometas fecha de publicación, resultado comercial, precios adicionales o condiciones no listadas. Para conocer alcance y propuesta invita a completar /onboarding.html; menciona la ruta como referencia interna para activar el botón de briefing, no la muestres como texto Markdown. No pidas contraseñas, datos financieros ni información personal sensible. No eres soporte técnico de productos de terceros.`;

async function handleChat(request, env) {
  if (!allowedPageRequest(request, env)) return json({ success: false, message: apiMessage(request, "Origen no permitido.", "Origin not allowed.") }, 403);
  if (!withinRateLimit(request)) return json({ success: false, message: apiMessage(request, "Has enviado varias consultas. Vuelve a intentarlo en unos minutos.", "You've sent several questions. Please try again in a few minutes.") }, 429, { "Retry-After": "900" });
  if (!env.ANTHROPIC_API_KEY) return json({ success: false, message: apiMessage(request, "El asistente está terminando de configurarse. Puedes dejar tu pregunta en el briefing.", "The assistant is still being configured. You can leave your question in the project brief.") }, 503);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return json({ success: false, message: apiMessage(request, "Tipo de contenido no permitido.", "Unsupported content type.") }, 415);

  let body;
  try {
    body = await readJsonBody(request, 12 * 1024);
  } catch (error) {
    const large = error instanceof RangeError;
    return json({ success: false, message: large ? apiMessage(request, "La consulta es demasiado larga.", "The message is too long.") : apiMessage(request, "Solicitud no válida.", "Invalid request.") }, large ? 413 : 400);
  }
  const visitorMessages = Array.isArray(body?.messages)
    ? body.messages.filter((item) => item?.role === "user").slice(-4).map((item) => clean(item.content, 1200)).filter(Boolean)
    : [];
  if (!visitorMessages.length) return json({ success: false, message: apiMessage(request, "Escribe una pregunta para continuar.", "Enter a question to continue.") }, 400);
  const messages = [{ role: "user", content: visitorMessages.join("\n\n") }];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: clean(env.ANTHROPIC_MODEL, 100) || "claude-sonnet-5",
        max_tokens: 420,
        system: `${CHAT_SYSTEM}\n${requestLocale(request) === "en" ? "Always reply in English, with a concise and friendly tone." : "Responde siempre en español, con un tono breve y amable."}`,
        messages
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.error("Anthropic chat failed", { status: response.status });
      return json({ success: false, message: apiMessage(request, "No pudimos responder ahora. Inténtalo de nuevo o continúa por el briefing.", "We couldn't reply just now. Try again or continue with the project brief.") }, 502);
    }
    const data = await response.json();
    const answer = clean((data.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n"), 3000);
    return answer ? json({ success: true, answer }) : json({ success: false, message: apiMessage(request, "No llegó una respuesta. Prueba otra vez.", "No reply came through. Please try again.") }, 502);
  } catch (error) {
    clearTimeout(timer);
    console.error("Anthropic chat unavailable", { name: error?.name || "Error" });
    return json({ success: false, message: apiMessage(request, "El asistente no está disponible ahora. Déjanos tu pregunta en el briefing.", "The assistant is unavailable right now. Leave your question in the project brief.") }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const configuredOrigin = configuredPublicOrigin(env);
    const canonicalOrigin = publicOrigin(env, request);
    if (configuredOrigin && url.origin !== configuredOrigin && url.origin !== DEFAULT_ORIGIN && !isLoopbackHost(url.hostname)) {
      const destination = new URL(`${url.pathname}${url.search}`, configuredOrigin);
      return applySecurityHeaders(new Response(null, {
        status: 308,
        headers: { Location: destination.href, "Cache-Control": "no-store" }
      }), url.pathname);
    }
    if (!configuredOrigin && PRODUCTION_HOSTS.has(url.hostname.toLowerCase()) && url.origin !== canonicalOrigin) {
      const destination = new URL(`${url.pathname}${url.search}`, canonicalOrigin);
      return applySecurityHeaders(new Response(null, {
        status: 308,
        headers: { Location: destination.href, "Cache-Control": "no-store" }
      }), url.pathname);
    }
    if (url.pathname === "/api/form-challenge") {
      if (request.method !== "GET") return methodNotAllowed(request, "GET");
      if (!allowedPageRequest(request, env)) return json({ success: false, message: apiMessage(request, "Origen no permitido.", "Origin not allowed.") }, 403);
      return createChallenge(request, env);
    }
    if (url.pathname === "/api/briefing") {
      if (request.method !== "POST") return methodNotAllowed(request, "POST");
      return handleBriefing(request, env);
    }
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") return methodNotAllowed(request, "POST");
      return handleChat(request, env);
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return applySecurityHeaders(new Response(apiMessage(request, "Método no permitido.", "Method not allowed."), {
        status: 405,
        headers: { "Allow": "GET, HEAD", "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
      }), url.pathname);
    }
    const normalizedPath = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    const cleanRoute = CLEAN_ROUTES.get(normalizedPath);
    const assetRequest = cleanRoute
      ? new Request(new URL(cleanRoute, request.url), request)
      : request;
    let response = await env.ASSETS.fetch(assetRequest);
    if (response.status === 404 && request.method === "GET" && request.headers.get("Accept")?.includes("text/html") && url.pathname !== "/404.html") {
      const notFound = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url), request));
      if (notFound.ok) response = new Response(notFound.body, { status: 404, headers: notFound.headers });
    }
    response = await rewriteSeoOrigin(response, url.pathname, canonicalOrigin);
    const stagingHost = !configuredOrigin && url.origin === DEFAULT_ORIGIN;
    return applySecurityHeaders(response, url.pathname, { noindex: url.origin !== canonicalOrigin || stagingHost });
  }
};
