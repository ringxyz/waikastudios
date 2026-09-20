import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import worker from "./worker/index.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "dist");
const port = Number(process.env.PORT || 3000);
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
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = normalize(join(publicRoot, relative));
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}${sep}`)) return null;
  return candidate;
}

async function assetResponse(request) {
  const path = assetPath(new URL(request.url).pathname);
  if (!path) return new Response("Not found", { status: 404 });
  try {
    const info = await stat(path);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const headers = {
      "Content-Type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "Content-Length": String(info.size)
    };
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(createReadStream(path), { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function envForHostinger() {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FORM_SIGNING_SECRET: process.env.FORM_SIGNING_SECRET,
    BRIEFING_FROM_EMAIL: process.env.BRIEFING_FROM_EMAIL,
    BRIEFING_REPLY_TO: process.env.BRIEFING_REPLY_TO,
    PUBLIC_SITE_ORIGIN: process.env.PUBLIC_SITE_ORIGIN,
    ASSETS: { fetch: assetResponse }
  };
}

function nodeRequest(request) {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || `localhost:${port}`;
  const url = `${protocol}://${host}${request.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value) headers.set(key, value);
  }
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
    reply.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    reply.end("Internal server error");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Waika Studios listening on port ${port}`);
});
