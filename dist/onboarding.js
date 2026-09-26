(() => {
const form = document.querySelector("#briefing-form");
const steps = [...document.querySelectorAll(".briefing-step")];
const backButton = document.querySelector("#back-button");
const nextButton = document.querySelector("#next-button");
const progressBar = document.querySelector("#progress-bar");
const stepLabel = document.querySelector("#step-label");
const progressPercent = document.querySelector("#progress-percent");
const status = document.querySelector("#briefing-status");
const progress = document.querySelector(".briefing-progress");
const actions = document.querySelector(".briefing-actions");
const saveNote = document.querySelector(".briefing-save");
const clearDraftButton = document.querySelector("#clear-draft");
const quoteCard = document.querySelector("#briefing-quote");
const quotePagesLabel = document.querySelector("#briefing-quote-pages");
const quoteFeaturesLabel = document.querySelector("#briefing-quote-features");
const quoteTotalLabel = document.querySelector("#briefing-quote-total");
const quoteCaption = document.querySelector("#briefing-quote-caption");
const storageKey = "waika-briefing-draft-v1";
const deliveryEndpoint = "/api/briefing";
const challengeEndpoint = "/api/form-challenge";
const draftLifetimeMs = 48 * 60 * 60 * 1000;
const quotePrices = Object.freeze({ admin: 100, form: 45, chatbot: 180, onboarding: 90, signup: 55, weekly: 140 });
const quoteAddonNames = Object.freeze({
  admin: "quote.addon.admin", form: "quote.addon.form", chatbot: "quote.addon.chatbot",
  onboarding: "quote.addon.onboarding", signup: "quote.addon.signup", weekly: "quote.addon.weekly"
});
let currentStep = 0;
let formChallenge = null;
let submissionId = createSubmissionId();
let quoteSelection = null;
let draftExpiryTimer;

function createSubmissionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const values = window.crypto?.getRandomValues
    ? window.crypto.getRandomValues(new Uint32Array(4))
    : [Date.now(), Math.floor(Math.random() * 0xffffffff), Math.floor(Math.random() * 0xffffffff), Math.floor(Math.random() * 0xffffffff)];
  return [...values].map((value) => Number(value).toString(16).padStart(8, "0")).join("-");
}

function t(key, spanish, english) {
  return window.waikaTranslate?.(key) || (document.documentElement.lang === "en" ? english : spanish);
}

function normalizeQuoteSelection(selection) {
  const pages = Number(selection?.pages);
  if (!Number.isInteger(pages) || pages < 1 || pages > 10 || !Array.isArray(selection?.addons)) return null;
  return { pages, addons: [...new Set(selection.addons)].filter((key) => Object.hasOwn(quotePrices, key)) };
}

function renderQuoteSelection() {
  if (!quoteCard) return;
  quoteCard.hidden = !quoteSelection;
  if (!quoteSelection) return;

  const en = document.documentElement.lang === "en";
  const pages = quoteSelection.pages;
  const addons = quoteSelection.addons;
  const estimate = 250 + ((pages - 1) * 75) + addons.reduce((sum, key) => sum + quotePrices[key], 0);
  quotePagesLabel.textContent = `${t("quote.briefPages", "Páginas", "Pages")}: ${pages}`;
  quoteFeaturesLabel.textContent = `${t("quote.briefExtras", "Funciones", "Features")}: ${addons.length
    ? addons.map((key) => t(quoteAddonNames[key], key, key)).join(", ")
    : t("quote.briefNoExtras", "Sin extras seleccionados", "No extras selected")}`;
  quoteTotalLabel.textContent = new Intl.NumberFormat(en ? "en-US" : "es-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  }).format(estimate);
  quoteCaption.textContent = t(
    "quote.briefCaption",
    "Estimación orientativa; confirmaremos el alcance antes de preparar la propuesta.",
    "Indicative estimate; we will confirm the scope before preparing your proposal."
  );
  document.querySelector("#briefing-quote-kicker").textContent = t(
    "quote.briefKicker",
    "Tu selección del presupuestador",
    "Your quote-builder selection"
  );
}

async function getFormChallenge() {
  if (formChallenge && Date.now() < formChallenge.expiresAt - 60_000) return formChallenge;
  const response = await fetch(challengeEndpoint, {
    method: "GET",
    headers: { Accept: "application/json", "Accept-Language": document.documentElement.lang === "en" ? "en" : "es" },
    credentials: "same-origin",
    cache: "no-store"
  });
  const result = await response.json();
  if (!response.ok || !result.token) throw new Error("No se pudo validar el formulario.");
  formChallenge = result;
  return result;
}

function readData() {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (key === "needs") {
      data.needs = data.needs || [];
      data.needs.push(value);
    } else if (key !== "consent") data[key] = value;
  });
  data.consent = form.elements.namedItem("consent")?.checked === true;
  return data;
}

function scheduleDraftExpiry(expiresAt) {
  window.clearTimeout(draftExpiryTimer);
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    try { localStorage.removeItem(storageKey); } catch {}
    quoteSelection = null;
    renderQuoteSelection();
    return;
  }
  draftExpiryTimer = window.setTimeout(() => {
    try { localStorage.removeItem(storageKey); } catch {}
    quoteSelection = null;
    renderQuoteSelection();
  }, remaining);
}

function saveDraft() {
  try {
    const savedAt = Date.now();
    localStorage.setItem(storageKey, JSON.stringify({ version: 2, savedAt, submissionId, data: readData(), quoteSelection }));
    scheduleDraftExpiry(savedAt + draftLifetimeMs);
  } catch {}
}

function restoreDraft() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch {}
  if (!saved) return;
  if (!saved.version || !saved.savedAt || Date.now() - saved.savedAt > draftLifetimeMs || !saved.data) {
    try { localStorage.removeItem(storageKey); } catch {}
    return;
  }
  scheduleDraftExpiry(saved.savedAt + draftLifetimeMs);
  if (/^[0-9a-f-]{36}$/i.test(saved.submissionId || "")) submissionId = saved.submissionId;
  quoteSelection = normalizeQuoteSelection(saved.quoteSelection);
  renderQuoteSelection();
  Object.entries(saved.data).forEach(([key, value]) => {
    if (key === "needs") {
      value.forEach((item) => { const input = form.querySelector(`[name="needs"][value="${item}"]`); if (input) input.checked = true; });
    } else if (key === "consent") {
      const consent = form.elements.namedItem("consent");
      if (consent) consent.checked = value;
    } else {
      const field = form.elements.namedItem(key);
      if (field && "value" in field) field.value = value;
    }
  });
}

function importQuoteSelection() {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get("quote");
  if (!raw || raw.length > 1000) return;

  try {
    const selection = JSON.parse(raw);
    quoteSelection = normalizeQuoteSelection(selection);
    if (!quoteSelection) return;
    renderQuoteSelection();
    const { pages, addons } = quoteSelection;
    const estimate = 250 + ((pages - 1) * 75) + addons.reduce((sum, key) => sum + quotePrices[key], 0);
    const money = new Intl.NumberFormat(document.documentElement.lang === "en" ? "en-US" : "es-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0
    }).format(estimate);
    const summary = [
      t("quote.briefTitle", "Estimación seleccionada en el presupuestador:", "Estimate selected in the quote builder:"),
      `${t("quote.briefPages", "Páginas", "Pages")}: ${pages}`,
      `${t("quote.briefExtras", "Funciones", "Features")}: ${addons.length
        ? addons.map((key) => t(quoteAddonNames[key], key, key)).join(", ")
        : t("quote.briefNoExtras", "Sin extras seleccionados", "No extras selected")}`,
      `${t("quote.briefEstimate", "Estimación orientativa", "Indicative estimate")}: ${money}`
    ].join("\n");
    const field = form.elements.namedItem("mustHave");
    if (field) {
      const markers = ["Estimación seleccionada en el presupuestador:", "Estimate selected in the quote builder:"];
      const lines = field.value.split("\n");
      let markerIndex;
      while ((markerIndex = lines.findIndex((line) => markers.includes(line.trim()))) !== -1) {
        lines.splice(markerIndex, 4);
      }
      const existingText = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      const separator = existingText ? "\n\n" : "";
      const available = Math.max(0, field.maxLength - existingText.length - separator.length);
      field.value = `${existingText}${separator}${summary.slice(0, available)}`;
      saveDraft();
    }
    url.searchParams.delete("quote");
    history.replaceState(null, "", `${url.pathname}${url.hash}`);
  } catch {
    url.searchParams.delete("quote");
    history.replaceState(null, "", `${url.pathname}${url.hash}`);
  }
}

function showStep(index, focusHeading = true) {
  currentStep = index;
  steps.forEach((step, stepIndex) => step.classList.toggle("is-active", stepIndex === index));
  const percent = Math.round(((index + 1) / steps.length) * 100);
  const en = document.documentElement.lang === "en";
  progress.setAttribute("aria-label", t("onboarding.progress", "Progreso del briefing", "Briefing progress"));
  stepLabel.textContent = `${t("onboarding.step", "Paso", "Step")} ${index + 1} ${en ? "of" : "de"} ${steps.length}`;
  progressPercent.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
  backButton.hidden = index === 0;
  const action = index === steps.length - 1
    ? t("onboarding.send", "Enviar briefing", "Send briefing")
    : t("onboarding.continue", "Continuar", "Continue");
  nextButton.innerHTML = `<span>${action}</span> <span aria-hidden="true">↗</span>`;
  status.textContent = "";
  const heading = steps[index].querySelector("legend");
  if (focusHeading) heading?.focus?.();
}

function validateStep() {
  const fields = [...steps[currentStep].querySelectorAll("input, textarea")];
  const required = fields.filter((field) => field.required);
  const radioGroups = [...new Set(required.filter((field) => field.type === "radio").map((field) => field.name))];
  const missingRadio = radioGroups.some((name) => !form.querySelector(`input[name="${name}"]:checked`));
  const invalid = required.find((field) => field.type !== "radio" && !field.checkValidity());
  if (missingRadio || invalid) {
    status.textContent = t("onboarding.required", "Completa este paso para continuar.", "Complete this step to continue.");
    status.className = "form-status error";
    (invalid || required.find((field) => field.type === "radio"))?.focus();
    return false;
  }
  return true;
}

function showCompletion() {
  steps.forEach((step) => { step.classList.remove("is-active"); step.hidden = true; });
  progress.hidden = true;
  actions.hidden = true;
  saveNote.hidden = true;
  form.classList.add("is-complete");
  status.textContent = t("onboarding.received", "Gracias. Tu briefing se ha enviado correctamente. Revisaremos la información y nos pondremos en contacto contigo lo antes posible.", "Thank you. Your briefing was sent successfully. We'll review it and get back to you as soon as we can.");
  status.className = "form-status ok briefing-success";
  status.setAttribute("tabindex", "-1");
  status.focus();
}

async function submitBriefing() {
  const data = readData();
  let challenge;
  try {
    challenge = await getFormChallenge();
    const remainingWait = challenge.issuedAt + challenge.minWaitMs - Date.now();
    if (remainingWait > 0) await new Promise((resolve) => window.setTimeout(resolve, remainingWait + 100));
  } catch {
    status.textContent = t("onboarding.invalid", "No pudimos validar el formulario. Recarga la página e inténtalo de nuevo.", "We couldn't validate the form. Reload the page and try again.");
    status.className = "form-status error";
    return;
  }
  const payload = {
    website: data.website || "",
    formChallenge: challenge.token,
    submissionId,
    name: data.name,
    email: data.email,
    Proyecto: data.project,
    Negocio: data.business,
    Audiencia: data.audience,
    Objetivo: data.goal,
    Resultado_esperado: data.success,
    Necesidades: (data.needs || []).join(", "),
    Imprescindible: data.mustHave,
    Secciones: data.sections,
    Materiales: data.materials,
    Referencias: data.referenceUrls || "No indicadas",
    Notas_visuales: data.referenceNotes || "No indicadas",
    Timing: data.timing || "No indicado",
    Consentimiento: data.consent ? "Sí" : "No",
    Origen: window.location.href
  };

  nextButton.disabled = true;
  backButton.disabled = true;
  nextButton.textContent = t("onboarding.sending", "Enviando tu briefing…", "Sending your briefing…");
  status.textContent = t("onboarding.sending", "Enviando tu briefing…", "Sending your briefing…");
  status.className = "form-status";

  try {
    const response = await fetch(deliveryEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Language": document.documentElement.lang === "en" ? "en" : "es" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || result.success !== true) throw new Error(result.message || "No se pudo entregar el briefing.");
    try { localStorage.removeItem(storageKey); } catch {}
    showCompletion();
  } catch (error) {
    formChallenge = null;
    nextButton.disabled = false;
    backButton.disabled = false;
    nextButton.innerHTML = `<span>${t("onboarding.send", "Enviar briefing", "Send briefing")}</span> <span aria-hidden="true">↗</span>`;
    status.textContent = error?.message || t("onboarding.error", "No pudimos enviarlo. Revisa la conexión e inténtalo de nuevo; tus respuestas siguen guardadas.", "We couldn't send it. Check your connection and try again; your answers are still saved.");
    status.className = "form-status error";
  }
}

nextButton.addEventListener("click", () => {
  if (!validateStep()) return;
  saveDraft();
  if (currentStep === steps.length - 1) submitBriefing();
  else showStep(currentStep + 1);
});
backButton.addEventListener("click", () => showStep(Math.max(0, currentStep - 1)));
form.addEventListener("input", saveDraft);
clearDraftButton?.addEventListener("click", () => {
  window.clearTimeout(draftExpiryTimer);
  try { localStorage.removeItem(storageKey); } catch {}
  quoteSelection = null;
  renderQuoteSelection();
  form.reset();
  submissionId = createSubmissionId();
  formChallenge = null;
  showStep(0);
  status.textContent = document.documentElement.lang === "en" ? "Saved answers cleared." : "Se borraron las respuestas guardadas.";
});
document.addEventListener("waika:locale-change", () => {
  renderQuoteSelection();
  showStep(currentStep, false);
});
restoreDraft();
importQuoteSelection();
showStep(0);
getFormChallenge().catch(() => {});
})();
