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
const storageKey = "waika-briefing-draft-v1";
const deliveryEndpoint = "/api/briefing";
let currentStep = 0;

function readData() {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (key === "needs") {
      data.needs = data.needs || [];
      data.needs.push(value);
    } else if (key !== "consent") data[key] = value;
  });
  data.consent = form.elements.consent.checked;
  return data;
}

function saveDraft() {
  localStorage.setItem(storageKey, JSON.stringify(readData()));
}

function restoreDraft() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  if (!saved) return;
  Object.entries(saved).forEach(([key, value]) => {
    if (key === "needs") {
      value.forEach((item) => { const input = form.querySelector(`[name="needs"][value="${item}"]`); if (input) input.checked = true; });
    } else if (key === "consent") form.elements.consent.checked = value;
    else if (form.elements[key]) form.elements[key].value = value;
  });
}

function showStep(index) {
  currentStep = index;
  steps.forEach((step, stepIndex) => step.classList.toggle("is-active", stepIndex === index));
  const percent = Math.round(((index + 1) / steps.length) * 100);
  stepLabel.textContent = `Paso ${index + 1} de ${steps.length}`;
  progressPercent.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
  backButton.hidden = index === 0;
  nextButton.innerHTML = index === steps.length - 1 ? "Enviar briefing <span>↗</span>" : "Continuar <span>↗</span>";
  status.textContent = "";
  const heading = steps[index].querySelector("legend");
  heading?.focus?.();
}

function validateStep() {
  const fields = [...steps[currentStep].querySelectorAll("input, textarea")];
  const required = fields.filter((field) => field.required);
  const radioGroups = [...new Set(required.filter((field) => field.type === "radio").map((field) => field.name))];
  const missingRadio = radioGroups.some((name) => !form.querySelector(`input[name="${name}"]:checked`));
  const invalid = required.find((field) => field.type !== "radio" && !field.checkValidity());
  if (missingRadio || invalid) {
    status.textContent = "Completa este paso para continuar.";
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
  status.textContent = "Briefing enviado. Ya está en camino a Waika Studios y responderemos al correo indicado.";
  status.className = "form-status ok briefing-success";
  status.setAttribute("tabindex", "-1");
  status.focus();
}

async function submitBriefing() {
  const data = readData();
  const payload = {
    website: "",
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
  nextButton.textContent = "Enviando…";
  status.textContent = `Enviando a ${form.dataset.recipient}…`;
  status.className = "form-status";

  try {
    const response = await fetch(deliveryEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || result.success !== true) throw new Error(result.message || "No se pudo entregar el briefing.");
    localStorage.removeItem(storageKey);
    showCompletion();
  } catch (error) {
    nextButton.disabled = false;
    backButton.disabled = false;
    nextButton.innerHTML = "Enviar briefing <span>↗</span>";
    status.textContent = "No pudimos enviarlo. Revisa la conexión e inténtalo de nuevo; tus respuestas siguen guardadas.";
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
restoreDraft();
showStep(0);
