const openOptions = (hash = "") =>
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash}`) }).then(() => window.close());

const calm = matchMedia("(prefers-reduced-motion: reduce)");
// Let a switch finish sliding before storage changes rebuild the popup.
const soon = (fn) => setTimeout(fn, calm.matches ? 0 : 170);
let firstPaint = true;

async function setRuleStatus(envId, ruleId, on) {
  const fresh = (await Store.load()).environments;
  const env = fresh.find((e) => e.id === envId);
  const target = env && env.rules.find((r) => r.id === ruleId);
  if (target) target.status = on ? "Active" : "Inactive";
  Store.save({ environments: fresh });
}

async function setEnvEnabled(envId, on) {
  const fresh = (await Store.load()).environments;
  const env = fresh.find((e) => e.id === envId);
  if (env) env.enabled = on;
  Store.save({ environments: fresh });
}

function envBlock(env, enabled) {
  const rules = Array.isArray(env.rules) ? env.rules : [];
  const active = rules.filter((r) => r.status === "Active").length;
  const live = enabled && env.enabled;
  const line = !enabled
    ? "Napping: nothing is mocked"
    : env.enabled
      ? `Mooing here · ${active} of ${rules.length} rule${rules.length === 1 ? "" : "s"} active`
      : "Environment paused · nothing is mocked here";

  const card = h(
    "div",
    { class: `card${live ? "" : " off"}` },
    h("div", { class: "glyph" }, icon("bolt")),
    h("div", { style: "flex:1;min-width:0" },
      h("strong", { class: "dom" }, envLabel(env)),
      h("span", {}, line)),
    toggle(env.enabled, (on) => {
      card.classList.toggle("off", !(enabled && on));
      list.classList.toggle("paused", !on);
      soon(() => setEnvEnabled(env.id, on));
    }, env.enabled ? "Pause this environment" : "Wake this environment")
  );

  const list = rules.length
    ? h(
        "div",
        { class: `list${env.enabled ? "" : " paused"}` },
        rules.map((rule) => {
          const on = rule.status === "Active";
          return h(
            "div",
            { class: `row${on ? "" : " paused"}`, "data-id": rule.id },
            toggle(on, (v) => {
              list.querySelector(`.row[data-id="${rule.id}"]`).classList.toggle("paused", !v);
              soon(() => setRuleStatus(env.id, rule.id, v));
            }, `${rule.name} active`, "sm"),
            h(
              "div",
              { class: "text" },
              h("span", { class: "name", title: rule.name }, rule.name),
              h("span", { class: "sub", title: ruleSummary(rule) }, ruleSummary(rule))
            ),
            !on && h("span", { class: "state" }, "Paused")
          );
        })
      )
    : h("div", { class: "empty" }, h("strong", {}, "No cows yet"), "Add a rule to this environment.");

  return h(
    "div",
    { class: "step" },
    card,
    list,
    h("button", {
      type: "button", class: "primary wide",
      onclick: () => openOptions(`#new=${encodeURIComponent(env.domain)}`),
    }, "+ New rule here")
  );
}

function noneBlock(host) {
  if (!host) {
    return h("div", { class: "card none" },
      h("div", { class: "glyph" }, icon("bolt")),
      h("div", {}, h("strong", {}, "This tab can't be mocked.")));
  }
  const domain = Env.suggestedDomain(host);
  return h(
    "div",
    { class: "step" },
    h("div", { class: "card none" },
      h("div", { class: "glyph" }, icon("bolt")),
      h("div", {},
        h("strong", { class: "dom" }, domain),
        h("span", {}, "No environment here, so nothing is mocked."))),
    h("button", {
      type: "button", class: "primary wide",
      onclick: () => openOptions(`#new=${encodeURIComponent(domain)}`),
    }, `+ Make ${domain} an environment`)
  );
}

async function render() {
  const { enabled, environments } = await Store.load();
  const total = environments.reduce((n, e) => n + (Array.isArray(e.rules) ? e.rules.length : 0), 0);
  const matches = host ? Env.matchingEnvironments(environments, host, { includeDisabled: true }) : [];

  document.getElementById("master").replaceChildren(
    toggle(enabled, (on) => {
      document.querySelectorAll(".card:not(.none)").forEach((c) => c.classList.toggle("off", !on));
      soon(() => Store.save({ enabled: on }));
    }, enabled ? "Turn Mockingmoo off" : "Turn Mockingmoo on")
  );

  const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  document.getElementById("root").replaceChildren(
    ...(matches.length ? matches.map((env) => envBlock(env, enabled)) : [noneBlock(host)]),
    h("span", { class: "sub", style: "text-align:center" },
      `${count(environments.length, "environment")} · ${count(total, "rule")} in total`)
  );

  if (firstPaint && !calm.matches) {
    document.querySelectorAll(".popup main > *, .row").forEach((el, i) =>
      el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
        duration: 240, delay: Math.min(i, 10) * 35, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards",
      })
    );
  }
  firstPaint = false;
}

const manage = document.getElementById("manage");
manage.append(icon("list"), "Open all environments");
manage.addEventListener("click", () => openOptions());

let host = null;
chrome.tabs.query({ active: true, currentWindow: true })
  .then(([tab]) => { host = Env.hostFromUrl(tab && tab.url); })
  .catch(() => {})
  .then(render);
chrome.storage.onChanged.addListener(render);
