import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { Script } from "node:vm";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicRoot = join(root, "dist");
const pages = [
  "index.html", "onboarding.html", "planes.html", "trabajos.html", "aplicaciones.html",
  "preguntas.html", "privacidad.html", "cookies.html", "terminos.html", "404.html"
];
const indexablePages = new Set(["index.html", "planes.html", "trabajos.html", "preguntas.html"]);
const cleanRoutes = new Map([
  ["/", "index.html"], ["/planes", "planes.html"], ["/trabajos", "trabajos.html"],
  ["/aplicaciones", "aplicaciones.html"], ["/preguntas", "preguntas.html"],
  ["/privacidad", "privacidad.html"], ["/cookies", "cookies.html"], ["/terminos", "terminos.html"]
]);
const errors = [];
const exists = async (path) => access(path, constants.F_OK).then(() => true, () => false);
const files = new Map();
for (const page of pages) files.set(page, await readFile(join(publicRoot, page), "utf8"));
const uiSource = await readFile(join(publicRoot, "site-ui.js"), "utf8");
const copyKeys = new Set([...uiSource.matchAll(/"([^"]+)":\s*\{/g)].map((match) => match[1]));

for (const page of pages) {
  const html = files.get(page);
  const fail = (message) => errors.push(`${page}: ${message}`);
  if (!/<title>[^<]+<\/title>/i.test(html)) fail("missing title");
  if (!/<meta\s+name="description"\s+content="[^"]+"/i.test(html)) fail("missing meta description");
  if (!/<h1\b/i.test(html)) fail("missing primary heading");
  if (page !== "404.html" && !/<link\s+rel="canonical"\s+href="https:\/\//i.test(html)) fail("missing absolute canonical");

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) fail(`duplicate IDs: ${[...new Set(duplicateIds)].join(", ")}`);
  const idsSet = new Set(ids);

  for (const [, key] of html.matchAll(/\bdata-i18n(?:-placeholder|-aria|-alt)?="([^"]+)"/g)) {
    if (!copyKeys.has(key)) fail(`missing translation key "${key}"`);
  }
  for (const [, value] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) continue;
    const url = new URL(value, "https://site.invalid/" + page);
    const pathname = decodeURIComponent(url.pathname);
    const cleanPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    const targetName = cleanRoutes.get(cleanPath) || cleanPath.replace(/^\/+/, "");
    const targetPath = normalize(join(publicRoot, targetName));
    if (targetPath !== publicRoot && !targetPath.startsWith(`${publicRoot}${sep}`)) {
      fail(`unsafe local reference: ${value}`);
      continue;
    }
    if (!(await exists(targetPath))) {
      fail(`missing local asset or route: ${value}`);
      continue;
    }
    if (url.hash && (targetName === page || targetName === cleanRoutes.get(new URL("https://site.invalid/" + page).pathname))) {
      const fragment = decodeURIComponent(url.hash.slice(1));
      if (fragment && !idsSet.has(fragment)) fail(`missing in-page target #${fragment}`);
    }
  }
  for (const [, tag] of html.matchAll(/<a\b([^>]*)>/gi)) {
    if (/\btarget="_blank"/i.test(tag) && !/\brel="[^"]*\bnoopener\b/i.test(tag)) fail("external new-tab link missing rel=\"noopener\"");
    if (/\bon(?:click|error|load|submit)\s*=/i.test(tag)) fail("inline event handler violates CSP");
  }
  if (/\bnoindex\b/i.test(html) === indexablePages.has(page)) {
    fail("robots indexability does not match the page's current launch status");
  }
  if (indexablePages.has(page)) {
    for (const property of ["og:title", "og:description", "og:image"]) {
      if (!new RegExp(`<meta\\s+property="${property.replace(":", ":")}"\\s+content="[^"]+"`, "i").test(html)) fail(`missing ${property} social metadata`);
    }
    for (const name of ["twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
      if (!new RegExp(`<meta\\s+name="${name}"\\s+content="[^"]+"`, "i").test(html)) fail(`missing ${name} social metadata`);
    }
    const image = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1];
    if (image) {
      try {
        const imagePath = join(publicRoot, decodeURIComponent(new URL(image).pathname).replace(/^\/+/, ""));
        if (!(await exists(imagePath))) fail(`social image is missing: ${image}`);
      } catch { fail(`social image URL is invalid: ${image}`); }
    }
  }
}

const browserFiles = ["app.js", "site-ui.js", "onboarding.js", "quote.js"];
const browserSources = new Map();
for (const file of browserFiles) {
  const source = await readFile(join(publicRoot, file), "utf8");
  browserSources.set(file, source);
  if (/MAKE_ONBOARDING_WEBHOOK_URL|ANTHROPIC_API_KEY|FORM_SIGNING_SECRET/.test(source)) errors.push(`${file}: server secret/configuration leaked to browser code`);
}
for (const [label, filesToCompile] of [
  ["onboarding page", ["app.js", "site-ui.js", "onboarding.js"]],
  ["quote page", ["app.js", "site-ui.js", "quote.js"]]
]) {
  try {
    new Script(filesToCompile.map((file) => browserSources.get(file)).join("\n;\n"), { filename: label });
  } catch (error) {
    errors.push(`${label}: scripts cannot load together as classic scripts (${error.message})`);
  }
}

const apps = files.get("aplicaciones.html");
if (/Captura de demostración pendiente/i.test(apps) && !/noindex/i.test(apps)) errors.push("aplicaciones.html: demo placeholders must remain noindex until safe screenshots are ready");
const quotePage = files.get("planes.html");
if (!/data-quote-builder/.test(quotePage) || !/type="range"/.test(quotePage) || !/data-price="\d+"/.test(quotePage)) {
  errors.push("planes.html: quote builder needs a page-count slider and priced feature options");
}
const notFoundPage = files.get("404.html");
if (!/noindex/i.test(notFoundPage) || !/notFound\.title/.test(browserSources.get("site-ui.js"))) {
  errors.push("404.html: branded not-found page must remain noindex and use translated copy");
}
const onboardingPage = files.get("onboarding.html");
if (!/id="back-button"[^>]*\bhidden\b/.test(onboardingPage)) errors.push("onboarding.html: back button should be hidden until the first step initializes");
if (!browserSources.get("onboarding.js").includes("function createSubmissionId()") || !browserSources.get("onboarding.js").includes("lines.splice(markerIndex, 4)")) {
  errors.push("onboarding.js: quote refresh must replace an earlier saved quote and tolerate browsers without randomUUID");
}
if (!onboardingPage.includes('id="briefing-quote"') || !browserSources.get("onboarding.js").includes("renderQuoteSelection()")) {
  errors.push("onboarding: quote-builder estimate must be visible and recalculated when the briefing opens");
}
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Site verification passed: ${pages.length} pages, local references, translation keys, canonical metadata and launch indexing.`);
}
