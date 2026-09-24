(() => {
  const builder = document.querySelector("[data-quote-builder]");
  if (!builder) return;

  const pageSlider = builder.querySelector("#quote-pages");
  const pageValue = builder.querySelector("#quote-pages-value");
  const totalOutput = builder.querySelector("#quote-total");
  const breakdown = builder.querySelector("#quote-breakdown");
  const cta = builder.querySelector("[data-quote-cta]");
  const eligible = builder.querySelector("[data-quote-guarantee]");
  const notEligible = builder.querySelector("[data-quote-not-eligible]");
  const addons = [...builder.querySelectorAll("input[data-price]")];
  const addonKeys = {
    admin: "quote.addon.admin",
    form: "quote.addon.form",
    chatbot: "quote.addon.chatbot",
    onboarding: "quote.addon.onboarding",
    signup: "quote.addon.signup",
    weekly: "quote.addon.weekly"
  };

  function translate(key, vars = {}) {
    let result = window.waikaTranslate?.(key) || key;
    for (const [name, value] of Object.entries(vars)) result = result.replaceAll(`{${name}}`, String(value));
    return result;
  }

  function locale() {
    return document.documentElement.lang === "en" ? "en-GB" : "es-ES";
  }

  function money(value) {
    return new Intl.NumberFormat(locale(), {
      style: "currency", currency: "EUR", maximumFractionDigits: 0
    }).format(value);
  }

  function line(label, value) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const amount = document.createElement("strong");
    name.textContent = label;
    amount.textContent = money(value);
    item.append(name, amount);
    return item;
  }

  function update() {
    const pageCount = Math.min(10, Math.max(1, Number(pageSlider.value) || 1));
    const chosen = addons.filter((input) => input.checked);
    const extrasTotal = chosen.reduce((sum, input) => sum + Number(input.dataset.price || 0), 0);
    const basePrice = 250;
    const pagePrice = (pageCount - 1) * 75;
    const total = basePrice + pagePrice + extrasTotal;
    const wordedCount = pageCount === 1
      ? translate("quote.onePage")
      : translate("quote.nPages", { count: pageCount });

    pageValue.textContent = wordedCount;
    totalOutput.textContent = money(total);
    builder.querySelectorAll("[data-quote-option-price]").forEach((price) => {
      price.textContent = `+${money(Number(price.dataset.quoteOptionPrice))}`;
    });

    const rows = [line(translate("quote.baseLine", { count: 1 }), basePrice)];
    if (pageCount > 1) {
      rows.push(line(
        translate(pageCount === 2 ? "quote.extraPage" : "quote.extraPages", { count: pageCount - 1 }),
        pagePrice
      ));
    }
    chosen.forEach((input) => rows.push(line(translate(addonKeys[input.value]), Number(input.dataset.price))));
    breakdown.replaceChildren(...rows);

    const hasGuarantee = pageCount === 1;
    eligible.hidden = !hasGuarantee;
    notEligible.hidden = hasGuarantee;
    cta.href = `/onboarding.html?quote=${encodeURIComponent(JSON.stringify({
      pages: pageCount,
      addons: chosen.map((input) => input.value),
      estimate: total
    }))}`;
  }

  pageSlider.addEventListener("input", update);
  addons.forEach((input) => input.addEventListener("change", update));
  document.addEventListener("waika:locale-change", update);
  update();
})();
