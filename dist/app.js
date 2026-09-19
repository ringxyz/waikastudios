const header = document.querySelector("[data-header]");
const scenes = [...document.querySelectorAll("[data-scene], [data-stagger]")];
const horizontal = document.querySelector("[data-horizontal]");
const rail = document.querySelector("[data-rail]");
const railCurrent = document.querySelector("[data-rail-current]");
const railProgress = document.querySelector("[data-rail-progress]");
const form = document.querySelector("#project-form");
const status = document.querySelector("#form-status");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const menuToggle = document.querySelector(".menu-toggle");
const mobileNav = document.querySelector("#mobile-nav");

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updateHeader() {
  header?.classList.toggle("is-scrolled", window.scrollY > 24);
}

function closeMobileNav() {
  document.body.classList.remove("menu-open");
  menuToggle?.setAttribute("aria-expanded", "false");
  menuToggle?.querySelector("b")?.replaceChildren(document.createTextNode("Abrir menú"));
}

menuToggle?.addEventListener("click", () => {
  const open = document.body.classList.toggle("menu-open");
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.querySelector("b")?.replaceChildren(document.createTextNode(open ? "Cerrar menú" : "Abrir menú"));
});
mobileNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMobileNav));
window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMobileNav(); });

function updateHorizontalRail() {
  if (!horizontal || !rail || prefersReducedMotion || window.innerWidth <= 860) return;

  const rect = horizontal.getBoundingClientRect();
  const travel = horizontal.offsetHeight - window.innerHeight;
  const progress = clamp(-rect.top / travel, 0, 1);
  const maxShift = rail.scrollWidth - window.innerWidth + (window.innerWidth * 0.08);
  rail.style.transform = `translate3d(${-maxShift * progress}px, 0, 0)`;
  if (railProgress) railProgress.style.transform = `scaleX(${progress})`;
  if (railCurrent) railCurrent.textContent = String(Math.min(5, Math.floor(progress * 5) + 1)).padStart(2, "0");
}

function updateHeroScrub() {
  if (prefersReducedMotion) return;
  const headline = document.querySelector("[data-scrub='headline']");
  const logo = document.querySelector(".kinetic-logo");
  const progress = clamp(window.scrollY / window.innerHeight, 0, 1);
  if (headline) headline.style.transform = `translate3d(0, ${progress * -34}px, 0)`;
  if (logo) logo.style.transform = `rotate(${-8 + progress * 18}deg) translate3d(${progress * -56}px, ${progress * 30}px, 0)`;
}

function updateSpotlight(event) {
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  card.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.18 });

scenes.forEach((scene, index) => {
  scene.style.transitionDelay = `${Math.min(index * 45, 220)}ms`;
  observer.observe(scene);
});

document.querySelectorAll(".rail-card, .manifesto-card").forEach((card) => {
  card.addEventListener("pointermove", updateSpotlight);
});

function onScroll() {
  updateHeader();
  updateHorizontalRail();
  updateHeroScrub();
}

window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", updateHorizontalRail);
onScroll();

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const missing = ["name", "project", "brief", "email"].filter((field) => !String(data[field] || "").trim());

  if (missing.length) {
    status.textContent = "Faltan campos obligatorios para guardar el briefing.";
    status.className = "form-status error";
    return;
  }

  const subject = encodeURIComponent(`Nuevo proyecto: ${data.project}`);
  const body = encodeURIComponent([
    `Nombre: ${data.name}`,
    `Email: ${data.email}`,
    `Proyecto: ${data.project}`,
    "",
    "Qué necesita construir:",
    data.brief,
    "",
    "Referencias:",
    data.referenceUrls || "No indicadas",
    "",
    "Qué le gusta de las referencias:",
    data.referenceNotes || "No indicado"
  ].join("\n"));

  status.textContent = "Tu solicitud está preparada. Se abrirá tu correo para enviarla.";
  status.className = "form-status ok";
  window.location.href = `mailto:waikastudios@gmail.com?subject=${subject}&body=${body}`;
});
