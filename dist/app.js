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
const hero = document.querySelector(".hero");
const heroSequence = document.querySelector("[data-frame-sequence]");
const heroSequenceContext = heroSequence?.getContext("2d");
const heroFrameCount = Number(heroSequence?.dataset.frameCount || 0);
const heroFrames = new Map();
let requestedHeroFrame = 0;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function heroFrameUrl(index) {
  return `/media/giro-frames/frame-${String(index + 1).padStart(3, "0")}.webp`;
}

function loadHeroFrame(index) {
  if (!heroSequence || !heroSequenceContext || index < 0 || index >= heroFrameCount) return Promise.resolve(null);
  if (heroFrames.has(index)) return heroFrames.get(index);
  const frame = new Image();
  const promise = new Promise((resolve) => {
    frame.onload = () => resolve(frame);
    frame.onerror = () => resolve(null);
  });
  frame.decoding = "async";
  frame.src = heroFrameUrl(index);
  heroFrames.set(index, promise);
  return promise;
}

async function drawHeroFrame(index) {
  requestedHeroFrame = index;
  const frame = await loadHeroFrame(index);
  if (!frame || index !== requestedHeroFrame || !heroSequenceContext) return;
  const width = Math.max(heroSequence.clientWidth, 1);
  const height = Math.max(heroSequence.clientHeight, 1);
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (heroSequence.width !== pixelWidth || heroSequence.height !== pixelHeight) {
    heroSequence.width = pixelWidth;
    heroSequence.height = pixelHeight;
  }
  const scale = Math.max(pixelWidth / frame.naturalWidth, pixelHeight / frame.naturalHeight);
  const frameWidth = frame.naturalWidth * scale;
  const frameHeight = frame.naturalHeight * scale;
  heroSequenceContext.clearRect(0, 0, pixelWidth, pixelHeight);
  heroSequenceContext.imageSmoothingEnabled = true;
  heroSequenceContext.imageSmoothingQuality = "high";
  heroSequenceContext.drawImage(frame, (pixelWidth - frameWidth) / 2, (pixelHeight - frameHeight) / 2, frameWidth, frameHeight);
  heroSequence.dataset.frame = String(index + 1);
  heroSequence.classList.add("is-ready");
}

function initHeroSequence() {
  if (!heroSequence || prefersReducedMotion || heroFrameCount === 0) return;
  drawHeroFrame(0);
  const preload = () => {
    for (let index = 1; index < heroFrameCount; index += 1) loadHeroFrame(index);
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(preload, { timeout: 1200 });
  else window.setTimeout(preload, 250);
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

function initCoverflow() {
  const carousel = document.querySelector("[data-coverflow]");
  const viewport = carousel?.querySelector("[data-coverflow-viewport]");
  const cards = [...(carousel?.querySelectorAll("[data-coverflow-card]") || [])];
  const current = carousel?.querySelector("[data-coverflow-current]");
  if (!carousel || !viewport || cards.length === 0) return;

  const state = { pos: 0, target: 0, width: 0, frame: null, drag: null, suppressClick: false, selected: 0 };
  const count = cards.length;
  const indexAt = (value) => ((Math.round(value) % count) + count) % count;

  const paint = () => {
    if (!state.width) return;
    const pitch = state.width * .7;
    cards.forEach((card, index) => {
      let offset = ((index - state.pos) % count + count) % count;
      if (offset > count / 2) offset -= count;
      const distance = Math.abs(offset);
      const ramp = Math.pow(distance, .66);
      const tilt = Math.min(42 * ramp, 76) * Math.sign(offset);
      card.style.transform = `translateX(calc(-50% + ${offset * pitch}px)) translateZ(${-state.width * .34 * ramp}px) rotateY(${-tilt}deg)`;
      card.style.opacity = String(distance < 2.5 ? 1 : Math.max(0, 1 - (distance - 2.5) / .75));
      card.style.zIndex = String(100 - Math.round(distance * 10));
      card.style.pointerEvents = distance < 2.5 ? "auto" : "none";
    });

    const selected = indexAt(state.pos);
    if (selected !== state.selected || !cards[state.selected].classList.contains("is-active")) {
      state.selected = selected;
      cards.forEach((card, index) => {
        const active = index === selected;
        card.classList.toggle("is-active", active);
        card.tabIndex = active ? 0 : -1;
        card.setAttribute("aria-current", active ? "true" : "false");
      });
      if (current) current.textContent = String(selected + 1).padStart(2, "0");
    }
  };

  const settle = (target) => {
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.target = target;
    if (prefersReducedMotion) {
      state.pos = target;
      paint();
      return;
    }
    const step = () => {
      const remaining = target - state.pos;
      if (Math.abs(remaining) < .0005) {
        state.pos = target;
        state.frame = null;
        paint();
        return;
      }
      state.pos += remaining * .15;
      paint();
      state.frame = requestAnimationFrame(step);
    };
    state.frame = requestAnimationFrame(step);
  };

  const goTo = (index) => {
    const target = index + Math.round((state.target - index) / count) * count;
    settle(target);
  };
  const nudge = (amount) => settle(Math.round(state.target) + amount);

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    viewport.setPointerCapture(event.pointerId);
    state.target = state.pos;
    state.drag = { id: event.pointerId, x: event.clientX, pos: state.pos, moved: false };
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!state.drag || state.drag.id !== event.pointerId || !state.width) return;
    const delta = event.clientX - state.drag.x;
    state.drag.moved ||= Math.abs(delta) > 7;
    state.pos = state.drag.pos - delta / (state.width * .7);
    state.target = state.pos;
    paint();
  });
  const endDrag = (event) => {
    if (!state.drag || state.drag.id !== event.pointerId) return;
    state.suppressClick = state.drag.moved;
    state.drag = null;
    settle(Math.round(state.pos));
    window.setTimeout(() => { state.suppressClick = false; }, 0);
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); nudge(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); nudge(1); }
  });
  viewport.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) < 1 && Math.abs(event.deltaX) < 1) return;
    const distance = (event.deltaX || event.deltaY) / Math.max(state.width * .7, 1);
    settle(state.target + distance * .9);
  }, { passive: true });
  cards.forEach((card, index) => card.addEventListener("click", (event) => {
    if (state.suppressClick) { event.preventDefault(); return; }
  }));
  carousel.querySelector("[data-coverflow-prev]")?.addEventListener("click", () => nudge(-1));
  carousel.querySelector("[data-coverflow-next]")?.addEventListener("click", () => nudge(1));

  const measure = () => {
    state.width = cards[0].offsetWidth;
    paint();
  };
  measure();
  new ResizeObserver(measure).observe(viewport);
}

function initMarquee() {
  const tracks = [...document.querySelectorAll("[data-marquee-track]")];
  if (tracks.length === 0 || prefersReducedMotion) return;
  const marquee = document.querySelector("[data-marquee]");
  const motionToggle = marquee?.querySelector("[data-marquee-toggle]");
  let paused = false;
  motionToggle?.addEventListener("click", () => {
    paused = !paused;
    const locale = document.documentElement.lang === "en" ? "en" : "es";
    const key = paused ? "marquee.resume" : "marquee.pause";
    motionToggle.setAttribute("aria-pressed", String(paused));
    motionToggle.dataset.i18nAria = key;
    motionToggle.querySelector(".sr-only").textContent = locale === "en"
      ? (paused ? "Resume motion" : "Pause motion")
      : (paused ? "Reanudar movimiento" : "Pausar movimiento");
    motionToggle.setAttribute("aria-label", motionToggle.querySelector(".sr-only").textContent);
    marquee.classList.toggle("is-motion-paused", paused);
  });
  const states = tracks.map((track) => ({ track, offset: 0, width: 0, speed: Number(track.dataset.speed) || -30, direction: 1 }));
  let previousTime = performance.now();
  let previousScroll = window.scrollY;
  let scrollVelocity = 0;

  const measure = () => states.forEach((item) => {
    item.width = item.track.firstElementChild?.getBoundingClientRect().width || 0;
    if (item.speed > 0 && item.offset === 0) item.offset = -item.width;
  });
  measure();
  const observer = new ResizeObserver(measure);
  states.forEach(({ track }) => observer.observe(track));
  if (marquee) observer.observe(marquee);
  document.fonts?.ready.then(measure);

  const animate = (time) => {
    const delta = Math.min((time - previousTime) / 1000, .05);
    const scrollDelta = window.scrollY - previousScroll;
    if (Math.abs(scrollDelta) > .1) {
      scrollVelocity += ((scrollDelta / Math.max(delta, .016)) - scrollVelocity) * .18;
      states.forEach((item) => { item.direction = scrollDelta < 0 ? -1 : 1; });
    } else {
      scrollVelocity *= .9;
    }
    previousScroll = window.scrollY;
    previousTime = time;
    const factor = 1 + Math.min(Math.abs(scrollVelocity) / 850, 2.5);

    states.forEach((item) => {
      if (!item.width || paused) return;
      item.offset += item.speed * item.direction * factor * delta;
      while (item.offset <= -item.width) item.offset += item.width;
      while (item.offset > 0) item.offset -= item.width;
      item.track.style.transform = `translate3d(${item.offset}px, 0, 0)`;
    });
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

initCoverflow();
initMarquee();
initHeroSequence();

document.querySelectorAll("[data-skip-intro]").forEach((link) => link.addEventListener("click", (event) => {
  const destination = document.querySelector(link.getAttribute("href"));
  if (!destination) return;
  event.preventDefault();
  history.pushState(null, "", link.getAttribute("href"));
  window.scrollTo({ top: destination.getBoundingClientRect().top + window.scrollY, behavior: "auto" });
  closeMobileNav();
  onScroll();
}));

function updateHorizontalRail() {
  if (!horizontal || !rail) return;
  if (prefersReducedMotion || window.innerWidth <= 1180 || window.innerHeight <= 920) {
    horizontal.style.height = "auto";
    rail.style.transform = "none";
    updateNativeRailProgress();
    return;
  }

  horizontal.style.removeProperty("height");
  const rect = horizontal.getBoundingClientRect();
  const travel = horizontal.offsetHeight - window.innerHeight;
  const progress = clamp(-rect.top / travel, 0, 1);
  const sticky = horizontal.querySelector(".horizontal-sticky");
  const stickyStyle = sticky ? getComputedStyle(sticky) : null;
  const sidePadding = stickyStyle
    ? parseFloat(stickyStyle.paddingLeft) + parseFloat(stickyStyle.paddingRight)
    : 0;
  const visibleWidth = window.innerWidth - sidePadding;
  const maxShift = Math.max(0, rail.scrollWidth - visibleWidth);
  rail.style.transform = `translate3d(${-maxShift * progress}px, 0, 0)`;
  if (railProgress) railProgress.style.transform = `scaleX(${progress})`;
  if (railCurrent) railCurrent.textContent = String(Math.min(5, Math.floor(progress * 5) + 1)).padStart(2, "0");
}

function updateNativeRailProgress() {
  if (!rail || !railCurrent || !railProgress) return;
  const maxScroll = Math.max(rail.scrollWidth - rail.clientWidth, 0);
  const fraction = maxScroll ? clamp(rail.scrollLeft / maxScroll, 0, 1) : 0;
  const current = Math.min(5, Math.round(fraction * 4) + 1);
  railCurrent.textContent = String(current).padStart(2, "0");
  railProgress.style.transform = `scaleX(${current / 5})`;
}

function updateHeroScrub() {
  if (prefersReducedMotion) return;
  const headline = document.querySelector("[data-scrub='headline']");
  const heroGrid = document.querySelector(".hero-grid");
  if (!hero) return;
  const rect = hero.getBoundingClientRect();
  const travel = Math.max(hero.offsetHeight - window.innerHeight, 1);
  const progress = clamp(-rect.top / travel, 0, 1);
  const frameIndex = Math.round(progress * Math.max(heroFrameCount - 1, 0));
  if (frameIndex !== requestedHeroFrame) drawHeroFrame(frameIndex);
  if (headline) headline.style.transform = `translate3d(0, ${progress * -34}px, 0)`;
  const copyOpacity = clamp(1 - progress / .34, 0, 1);
  hero.style.setProperty("--hero-copy-opacity", copyOpacity.toFixed(3));
  hero.style.setProperty("--hero-cue-opacity", String(progress < .08 ? 1 : 0));
  if (heroGrid) {
    const hidden = progress > .38;
    heroGrid.style.visibility = hidden ? "hidden" : "visible";
    heroGrid.setAttribute("aria-hidden", String(hidden));
  }
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
window.addEventListener("resize", () => { updateHorizontalRail(); updateHeroScrub(); });
rail?.addEventListener("scroll", updateNativeRailProgress, { passive: true });
onScroll();
