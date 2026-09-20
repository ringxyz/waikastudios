import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
let emailCalls = 0;
let webhookCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).startsWith("https://hook.us1.make.com/")) {
    webhookCalls += 1;
    return new Response("Accepted");
  }
  emailCalls += 1;
  return Response.json({ id: `email-${emailCalls}` });
};

const origin = "https://waikastudios.waikastudios.chatgpt.site";
const env = {
  FORM_SIGNING_SECRET: "local-test-secret-that-is-not-used-in-production",
  MAKE_ONBOARDING_WEBHOOK_URL: "https://hook.us1.make.com/test-webhook",
  RESEND_API_KEY: "local-test-resend-key",
  ASSETS: { fetch: async () => new Response("asset") }
};

try {
  const missingOrigin = await worker.fetch(new Request(`${origin}/api/form-challenge`), env);
  assert.equal(missingOrigin.status, 403);

  const challengeResponse = await worker.fetch(new Request(`${origin}/api/form-challenge`, {
    headers: { Referer: `${origin}/onboarding.html` }
  }), env);
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  assert.ok(challenge.token);

  const noOrigin = await worker.fetch(new Request(`${origin}/api/briefing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }), env);
  assert.equal(noOrigin.status, 403);

  const honeypot = await worker.fetch(new Request(`${origin}/api/briefing`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ website: "spam.example" })
  }), env);
  assert.equal(honeypot.status, 200);
  assert.equal(emailCalls, 0);
  assert.equal(webhookCalls, 0);

  const tampered = await worker.fetch(new Request(`${origin}/api/briefing`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ formChallenge: `${challenge.token}x` })
  }), env);
  assert.equal(tampered.status, 403);

  await new Promise((resolve) => setTimeout(resolve, challenge.minWaitMs + 100));
  const validPayload = {
    website: "",
    formChallenge: challenge.token,
    name: "Prueba Waika",
    email: "prueba@example.com",
    Proyecto: "Proyecto seguro",
    Negocio: "Diseño digital",
    Audiencia: "Empresas",
    Objetivo: "presentar",
    Resultado_esperado: "Más solicitudes",
    Necesidades: "corporativa",
    Imprescindible: "Formulario",
    Secciones: "Inicio y contacto",
    Materiales: "Logo",
    Referencias: "No indicadas",
    Notas_visuales: "No indicadas",
    Timing: "Sin fecha",
    Consentimiento: "Sí",
    Origen: `${origin}/onboarding.html`
  };
  const valid = await worker.fetch(new Request(`${origin}/api/briefing`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(validPayload)
  }), env);
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).success, true);
  assert.equal(webhookCalls, 1);
  assert.equal(emailCalls, 1);

  const asset = await worker.fetch(new Request(`${origin}/`), env);
  assert.equal(asset.headers.get("X-Frame-Options"), "DENY");
  assert.match(asset.headers.get("Content-Security-Policy"), /default-src 'self'/);
  console.log("worker security tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
