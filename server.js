import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { isIP } from "node:net";
import worker from "./worker/index.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "dist");
const port = Number(process.env.PORT || 3000);
const cleanRoutes = new Map([
  ["/planes", "planes.html"],
  ["/trabajos", "trabajos.html"],
  ["/aplicaciones", "aplicaciones.html"],
  ["/preguntas", "preguntas.html"],
  ["/privacidad", "privacidad.html"],
  ["/cookies", "cookies.html"],
  ["/terminos", "terminos.html"]
]);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function assetPath(urlPath) {
  let pathname;
  try { pathname = decodeURIComponent(urlPath.split("?")[0]); }
  catch { return null; }
  if (pathname.endsWith("/") && pathname !== "/") pathname = pathname.slice(0, -1);
  const relative = pathname === "/" ? "index.html" : cleanRoutes.get(pathname) || pathname.replace(/^\/+/, "");
  const candidate = normalize(join(publicRoot, relative));
  if (candidate !== publicRoot && !candidate.startsWith(publicRoot + sep)) return null;
  return candidate;
}

async function assetResponse(request) {
  const path = assetPath(new URL(request.url).pathname);
  if (!path) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(path);
    const headers = {
      "Content-Type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "Content-Length": String(body.byteLength)
    };
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(body, { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function envForHostinger() {
  return {
    FORM_SIGNING_SECRET: process.env.FORM_SIGNING_SECRET,
    MAKE_ONBOARDING_WEBHOOK_URL: process.env.MAKE_ONBOARDING_WEBHOOK_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    TRUST_HOSTINGER_CDN: process.env.TRUST_HOSTINGER_CDN,
    PUBLIC_SITE_ORIGIN: process.env.PUBLIC_SITE_ORIGIN,
    ASSETS: { fetch: assetResponse }
  };
}

function nodeRequest(request) {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || "localhost:" + port;
  const url = protocol + "://" + host + request.url;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value) headers.set(key, value);
  }
  headers.delete("CF-Connecting-IP");
  let clientIp = request.socket.remoteAddress || "unknown";
  if (process.env.TRUST_HOSTINGER_CDN === "true") {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",").map((value) => value.trim()).filter(Boolean);
    const hostingerAppendedIp = forwarded.at(-1);
    if (hostingerAppendedIp && isIP(hostingerAppendedIp)) clientIp = hostingerAppendedIp;
  }
  headers.set("X-Waika-Client-IP", isIP(clientIp) ? clientIp : "unknown");
  const hasBody = !["GET", "HEAD"].includes(request.method);
  return new Request(url, { method: request.method, headers, body: hasBody ? request : undefined, duplex: hasBody ? "half" : undefined });
}

async function sendResponse(response, reply) {
  reply.statusCode = response.status;
  response.headers.forEach((value, key) => reply.setHeader(key, value));
  if (!response.body || reply.req.method === "HEAD") return reply.end();
  const buffer = Buffer.from(await response.arrayBuffer());
  reply.end(buffer);
}

const server = createServer(async (request, reply) => {
  try {
    const response = await worker.fetch(nodeRequest(request), envForHostinger());
    await sendResponse(response, reply);
  } catch (error) {
    console.error("Request failed", error);
    const headers = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin"
    };
    if (/^https:\/\//i.test(process.env.PUBLIC_SITE_ORIGIN || "")) {
      headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    }
    reply.writeHead(500, headers);
    reply.end("Internal server error");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log("Waika Studios listening on port " + port);
});
