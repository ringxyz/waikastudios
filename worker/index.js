// Cloudflare Worker entrypoint for the Waika Studios onboarding form.
const ALLOWED_ORIGINS = new Set([
  "https://waikastudios.waikastudios.chatgpt.site"
]);

const MAX_BODY_BYTES = 64 * 1024;
const REQUIRED_FIELDS = [
  "name", "email", "Proyecto", "Negocio", "Audiencia", "Objetivo",
  "Resultado_esperado", "Imprescindible", "Secciones", "Materiales"
];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function clean(value, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
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

async function handleBriefing(request, env) {
  const origin = request.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ success: false, message: "Origen no permitido." }, 403);
  if (!env.RESEND_API_KEY) return json({ success: false, message: "El servicio de correo no está configurado." }, 503);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ success: false, message: "La solicitud es demasiado grande." }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "Solicitud no válida." }, 400);
  }

  if (clean(body.website, 200)) return json({ success: true });

  const fields = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, clean(value)]));
  const missing = REQUIRED_FIELDS.find((key) => !fields[key]);
  if (missing || !validEmail(fields.email) || fields.Consentimiento !== "Sí") {
    return json({ success: false, message: "Faltan datos obligatorios o el correo no es válido." }, 400);
  }

  const idempotencySource = `${fields.email}|${fields.Proyecto}|${fields.Origen}|${new Date().toISOString().slice(0, 10)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(idempotencySource));
  const idempotencyKey = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `waika-briefing-${idempotencyKey}`
    },
    body: JSON.stringify({
      from: "Waika Studios <onboarding@resend.dev>",
      to: ["waikastudios@gmail.com"],
      reply_to: fields.email,
      subject: `Nuevo briefing: ${fields.Proyecto}`.slice(0, 180),
      html: emailHtml(fields)
    })
  });

  const resendResult = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok || !resendResult.id) {
    console.error("Resend rejected briefing", resendResponse.status, resendResult);
    return json({ success: false, message: "El correo no pudo entregarse. Inténtalo de nuevo en unos minutos." }, 502);
  }

  return json({ success: true, deliveryId: resendResult.id });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/briefing") {
      if (request.method !== "POST") return json({ success: false, message: "Método no permitido." }, 405);
      return handleBriefing(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
