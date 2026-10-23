const OPERATORS = [
  ["Contains", "URL contains"],
  ["Equals", "URL equals"],
  ["Matches", "URL matches regex"],
  ["Wildcard_Matches", "URL matches wildcard (*)"],
];

const CODE_TEMPLATE = `function modifyResponse({ url, method, requestData, response, responseJSON, statusCode }) {
  // \`response\` is the real body as a string; \`responseJSON\` is the parsed version, if it was JSON.
  // Return a string or an object to replace it, or \`undefined\` to leave it alone.

  return response;
}
`;

let state = { enabled: true, environments: [] };
const open = new Set();     // keys (see key()) of expanded rule cards
const openEnvs = new Set(); // ids of expanded environment bands
let saveTimer;

const newPair = () => ({
  id: newId(),
  source: { key: "Url", operator: "Contains", value: "" },
  response: { type: "code", value: CODE_TEMPLATE, statusCode: "200", serveWithoutRequest: true },
});

const CODE_HINT = 'This looks like JS code, but a static body is returned as plain text and never runs. Switch the type to "Rewrite response with JS".';
const looksLikeCode = (response) => response.type === "static" && /function\s+modifyResponse/.test(response.value || "");

const say = (text) => (document.getElementById("msg").textContent = text);

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => Store.save({ environments: state.environments }), 250);
}

function select(options, value, onchange) {
  const el = h("select", { onchange: (e) => onchange(e.target.value) }, options.map(([v, label]) => h("option", { value: v }, label)));
  el.value = value;
  return el;
}

async function formatBody(response, area, note) {
  const format = (parser) =>
    prettier.format(area.value, { parser, plugins: [prettierPlugins.babel, prettierPlugins.estree] });
  note.textContent = "";
  note.classList.remove("info");
  try {
    if (response.type === "code") {
      area.value = await format("babel");
    } else {
      try {
        area.value = await format("json");
      } catch (jsonError) {
        // Not valid JSON: format it as JS, since a static body may hold code pasted under the wrong type.
        try {
          area.value = await format("babel");
        } catch (e) {
          throw jsonError;
        }
        note.classList.add("info");
        note.textContent = "Formatted as JavaScript. A static body is returned as-is; switch the type to \"Rewrite response with JS\" to run this code.";
      }
    }
    response.value = area.value;
    save();
    play(area.closest(".editor"), [{ boxShadow: "0 0 0 0 rgba(255,200,87,.9)" }, { boxShadow: "0 0 0 8px rgba(255,200,87,0)" }], { duration: 600 });
  } catch (err) {
    note.textContent = err.message.split("\n")[0];
  }
}

// ---- motion ---------------------------------------------------------------
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const EASE = "cubic-bezier(.2, .8, .2, 1)";
let busy = false;    // a card is mid-animation; ignore repeat clicks
let pending = null;  // { envId, ruleId, kind: "expand" | "enter" } to play after the next render
let settle = true;   // fade the list in on the next render (load, search, filter)

// The same rule id can exist in several environments (one file imported twice), so UI state is keyed by both.
const key = (env, rule) => `${env.id}/${rule.id}`;
const cardEl = (envId, ruleId) => {
  const band = envEl(envId);
  return band && band.querySelector(`.rule[data-id="${CSS.escape(ruleId)}"]`);
};
const play = (el, frames, opts) => (calm.matches || !el ? Promise.resolve() : el.animate(frames, { easing: EASE, ...opts }).finished);

function heightFrames(el, opening) {
  const cs = getComputedStyle(el);
  const full = { height: `${el.scrollHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 };
  const shut = { height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 };
  return opening ? [shut, full] : [full, shut];
}

function afterRender() {
  const job = pending;
  pending = null;
  if (job) {
    const card = cardEl(job.envId, job.ruleId);
    if (card && job.kind === "enter") {
      play(card, [
        { opacity: 0, transform: "translateY(-10px) scale(.97)" },
        { opacity: 1, transform: "translateY(2px) scale(1.005)", offset: 0.7 },
        { opacity: 1, transform: "none" },
      ], { duration: 360 });
    }
    if (card) {
      const body = card.querySelector(".body");
      if (body) { body.style.overflow = "hidden"; play(body, heightFrames(body, true), { duration: 300 }).then(() => (body.style.overflow = "")); }
      play(card.querySelector(".chev"), [{ transform: "rotate(0deg)" }, { transform: "rotate(180deg)" }], { duration: 300 });
    }
  }
  if (settle) {
    settle = false;
    [...document.getElementById("environments").children].slice(0, 12).forEach((el, i) =>
      play(el, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: i * 30, fill: "backwards" })
    );
  }
}

async function expand(env, rule) {
  if (busy) return;
  busy = true;
  if (open.has(key(env, rule))) {
    const card = cardEl(env.id, rule.id);
    const body = card && card.querySelector(".body");
    if (body) {
      body.style.overflow = "hidden";
      await Promise.all([
        play(body, heightFrames(body, false), { duration: 220, fill: "forwards" }),
        play(card.querySelector(".chev"), [{ transform: "rotate(180deg)" }, { transform: "rotate(0deg)" }], { duration: 220, fill: "forwards" }),
      ]);
    }
    open.delete(key(env, rule));
  } else {
    open.add(key(env, rule));
    pending = { envId: env.id, ruleId: rule.id, kind: "expand" };
  }
  busy = false;
  render();
}

// ---- environments ---------------------------------------------------------
const DUPLICATE_HINT = "That domain already has an environment";
const INVALID_HINT = "That doesn't look like a domain. Try something like staging.myapp.com or localhost:3000.";
const PARKED_HINT = "Add a domain. Until then this environment is parked and mocks nothing.";

const envEl = (id) => document.querySelector(`.env[data-env-id="${CSS.escape(id)}"]`);

// Objects captured before an await or an open menu can be stale (storage may have replaced state); resolve by id at action time.
const findEnv = (id) => state.environments.find((e) => e.id === id);
const findRule = (env, id) => env && env.rules.find((r) => r.id === id);
const gone = () => { say("That cow has already left the herd."); render(); };

function addEnvironment({ domain = "", name = "", focus = true } = {}) {
  // A domain that fails validation (e.g. an IPv6 host from the popup) opens a blank band to fill in, never a stored null.
  const env = Env.createEnvironment({ domain: Env.isValidDomain(domain) ? domain : "", name });
  state.environments.unshift(env);
  openEnvs.add(env.id);
  query = "";
  filter = "all";
  document.getElementById("search").value = "";
  settle = true;
  save(); render();
  if (focus) {
    const band = envEl(env.id);
    const input = band && band.querySelector("input.domain");
    if (input) input.focus();
  }
  return env;
}

async function removeEnvironment(env) {
  const n = env.rules.length;
  const ok = await confirmDialog({
    title: `Delete “${envLabel(env)}”?`,
    body: `This takes ${n} ${n === 1 ? "rule" : "rules"} with it. Export first if you might want them back.`,
    confirmLabel: "Delete environment",
  });
  if (!ok) return;
  const live = findEnv(env.id);
  if (!live) return gone();
  state.environments = state.environments.filter((e) => e !== live);
  live.rules.forEach((r) => open.delete(key(live, r)));
  openEnvs.delete(live.id);
  save(); render();
}

// Normalises and applies a typed domain. Returns false (and reverts the field) when it is invalid or another environment owns it.
function setDomain(env, raw) {
  const band = envEl(env.id);
  const input = band && band.querySelector("input.domain");
  const hint = band && band.querySelector(".domain-hint");
  const next = Env.normalizeDomain(raw);
  if (next === null) {
    if (input) input.value = env.domain;
    if (hint) hint.textContent = INVALID_HINT;
    return false;
  }
  if (next && next !== env.domain && Env.findByDomain(state.environments, next)) {
    if (input) input.value = env.domain;
    if (hint) hint.textContent = DUPLICATE_HINT;
    return false;
  }
  const wasParked = Env.isParked(env);
  env.domain = next;
  save();
  if (input) input.value = next;
  if (wasParked !== Env.isParked(env)) render();
  else if (hint) hint.textContent = Env.isParked(env) ? PARKED_HINT : "";
  return true;
}

function addRuleTo(env) {
  const rule = { id: newId(), name: "New rule", description: "", status: "Active", pairs: [newPair()] };
  env.rules.unshift(rule);
  open.add(key(env, rule));
  openEnvs.add(env.id);
  pending = { envId: env.id, ruleId: rule.id, kind: "enter" };
  query = "";
  filter = "all";
  document.getElementById("search").value = "";
  save(); render();
  return rule;
}

function matchesQuery(env, rule) {
  if (!query) return true;
  const hay = [env.domain, env.name, rule.name, ...(rule.pairs || []).map((p) => p.source.value)].join(" ").toLowerCase();
  return hay.includes(query);
}

function envBand(env) {
  const isOpen = openEnvs.has(env.id);
  const parked = Env.isParked(env);
  const shown = env.rules.filter(
    (r) => matchesQuery(env, r) && (filter === "all" || (filter === "active") === (r.status === "Active"))
  );
  return h(
    "section",
    { class: `env${parked ? " parked" : ""}${env.enabled ? "" : " off"}${isOpen ? " open" : ""}`, "data-env-id": env.id, "aria-label": `Environment: ${envLabel(env)}` },
    h(
      "div",
      { class: "env-head" },
      toggle(env.enabled, (on) => { env.enabled = on; save(); soon(render); }, "Environment active"),
      h(
        "div",
        { class: "title" },
        h("input", {
          type: "text", class: "mono domain", value: env.domain, placeholder: "hello.com", spellcheck: false,
          "aria-label": "Environment domain", onchange: (e) => setDomain(env, e.target.value),
        }),
        h("span", { class: "hint domain-hint" }, parked ? PARKED_HINT : ""),
        h("input", {
          type: "text", class: "env-name", value: env.name, placeholder: "Name (optional)",
          "aria-label": "Environment name", oninput: (e) => { env.name = e.target.value; save(); },
        }),
        h("span", { class: "summary" }, envSummary(env))
      ),
      parked && h("span", { class: "badge parked" }, "Parked · not applied anywhere"),
      h(
        "div",
        { class: "tools" },
        h("button", { type: "button", onclick: () => addRuleTo(env) }, icon("plus"), "Rule"),
        h("button", {
          type: "button", class: "icon-btn", title: isOpen ? "Collapse" : "Expand", "aria-label": isOpen ? "Collapse environment" : "Expand environment",
          "aria-expanded": String(isOpen), onclick: () => { if (isOpen) openEnvs.delete(env.id); else openEnvs.add(env.id); render(); },
        }, h("span", { class: `chev${isOpen ? " flipped" : ""}` }, icon("down"))),
        h("button", { type: "button", class: "icon-btn danger", title: "Delete", "aria-label": "Delete environment", onclick: () => removeEnvironment(env) }, icon("trash"))
      )
    ),
    isOpen &&
      h(
        "div",
        { class: "env-body" },
        !env.rules.length
          ? h("div", { class: "empty" }, h("strong", {}, "No rules here."), "This domain stays real until you say otherwise.")
          : !shown.length
            ? h("div", { class: "empty" }, h("strong", {}, "No cows match"), "Try another search or filter.")
            : shown.map((rule) => ruleCard(env, rule))
      )
  );
}

async function removeRule(env, rule) {
  const ok = await confirmDialog({
    title: `Delete “${rule.name || "Untitled rule"}”?`,
    body: "This cow leaves the herd for good. Export first if you might want it back.",
    confirmLabel: "Delete rule",
  });
  if (!ok) return;
  if (!findRule(findEnv(env.id), rule.id)) return gone();
  const card = cardEl(env.id, rule.id);
  if (card) {
    card.style.overflow = "hidden";
    await play(card, [
      { height: `${card.offsetHeight}px`, opacity: 1, transform: "none", marginBottom: "0px" },
      { height: `${card.offsetHeight}px`, opacity: 0, transform: "translateX(24px) rotate(1deg)", marginBottom: "0px", offset: 0.55 },
      { height: "0px", opacity: 0, transform: "translateX(24px)", marginBottom: "-16px", borderWidth: "0px" },
    ], { duration: 340, fill: "forwards" });
  }
  // The animation takes a moment; look the target up again before changing anything.
  const liveEnv = findEnv(env.id);
  const liveRule = findRule(liveEnv, rule.id);
  if (!liveRule) return gone();
  liveEnv.rules = liveEnv.rules.filter((r) => r !== liveRule);
  open.delete(key(liveEnv, liveRule));
  save(); render();
}

// Let a switch finish sliding before the page is rebuilt underneath it.
const soon = (fn) => setTimeout(fn, calm.matches ? 0 : 170);

const TYPES = [["code", "Rewrite with JS"], ["static", "Static response"]];
let query = "";
let filter = "all";

function setType(response, v) {
  if (response.type === v) return;
  // Swap the untouched placeholder so a fresh rule doesn't keep the other type's boilerplate.
  if (response.value === CODE_TEMPLATE && v === "static") response.value = "{}";
  else if (response.value === "{}" && v === "code") response.value = CODE_TEMPLATE;
  response.type = v;
  save(); render();
}

function pairEditor(rule, pair, index) {
  const { source, response } = pair;
  const isStatic = response.type === "static";
  const note = h("span", { class: "format-note", role: "status" });
  const hint = () => {
    note.classList.add("info");
    note.textContent = looksLikeCode(response) ? CODE_HINT : "";
  };
  hint();
  const area = h("textarea", {
    value: response.value || "",
    spellcheck: false,
    "aria-label": isStatic ? "Response body" : "modifyResponse code",
    oninput: (e) => { response.value = e.target.value; hint(); save(); },
  });
  const many = rule.pairs.length > 1;
  return h(
    "div",
    { class: "pair" },
    h(
      "div",
      { class: "step" },
      h("div", { class: "step-label" }, h("span", { class: "num" }, many ? `${index + 1}a` : "1"), "When the request URL…"),
      h(
        "div",
        { class: "line" },
        select(OPERATORS, source.operator, (v) => { source.operator = v; save(); render(); }),
        h("input", {
          type: "text",
          class: "mono",
          value: source.value,
          placeholder: "e.g. /api/users",
          "aria-label": "URL pattern",
          oninput: (e) => {
            source.value = e.target.value;
            e.target.closest(".step").querySelector(".blank-note").classList.toggle("gone", !!source.value.trim());
            const summary = e.target.closest(".rule").querySelector(".summary");
            summary.textContent = summary.title = ruleSummary(rule);
            save();
          },
        }),
        many &&
          h("button", {
            type: "button", class: "ghost icon-btn", "aria-label": "Remove this URL match", title: "Remove this URL match",
            onclick: () => { rule.pairs = rule.pairs.filter((p) => p !== pair); save(); render(); },
          }, icon("x"))
      ),
      h("span", { class: `hint blank-note${String(source.value || "").trim() ? " gone" : ""}`, "aria-hidden": "false" },
        "Add a URL pattern. Until then this match does nothing, so a new rule can't hijack every request.")
    ),
    h(
      "div",
      { class: "step" },
      h("div", { class: "step-label" }, h("span", { class: "num" }, many ? `${index + 1}b` : "2"), "…then moo back with"),
      segmented({
        key: `type-${pair.id}`, items: TYPES, value: response.type, tabs: true, cls: "type",
        label: "Response type", onPick: (v) => setType(response, v),
      }),
      isStatic &&
        h(
          "div",
          { class: "line" },
          h("label", {}, "Status", h("input", {
            type: "number", value: response.statusCode || "200", min: 100, max: 599,
            oninput: (e) => { response.statusCode = e.target.value; save(); },
          })),
          h("label", {}, h("input", {
            type: "checkbox", checked: response.serveWithoutRequest !== false,
            onchange: (e) => { response.serveWithoutRequest = e.target.checked; save(); },
          }), "Skip the network (fetch only)")
        ),
      h(
        "div",
        { class: "editor" },
        h(
          "div",
          { class: "bar" },
          h("span", {}, isStatic ? "response-body" : "modifyResponse.js"),
          h("button", { type: "button", onclick: () => formatBody(response, area, note) }, "Prettier")
        ),
        area
      ),
      note,
      !isStatic &&
        h("div", { class: "hint" }, "Gets ",
          ["url", "method", "requestData", "response", "responseJSON", "statusCode"].flatMap((n, i, all) => [
            h("code", {}, n), i < all.length - 2 ? ", " : i === all.length - 2 ? " and " : "",
          ]),
          ". Return a string or an object. Sites with a strict Content Security Policy (e.g. Outlook, GitHub) block JS rewrites; use a static response there.")
    )
  );
}

function cloneRule(rule) {
  const copy = JSON.parse(JSON.stringify(rule));
  copy.id = newId();
  copy.name = `${rule.name} (copy)`;
  copy.status = "Inactive";
  copy.pairs.forEach((p) => (p.id = newId()));
  return copy;
}

// ---- copy, import, export -------------------------------------------------
let closeMenu = null;

// Decodes a URL fragment value; a malformed escape (e.g. "%") falls back to the raw text.
function safeDecode(text) {
  try { return decodeURIComponent(text); } catch (e) { return text; }
}

function copyMenu(button, fromEnv, rule) {
  if (closeMenu) closeMenu();
  const others = state.environments.filter((e) => e !== fromEnv);
  const menu = h("div", { class: "menu", role: "menu" },
    others.map((to) => h("button", { type: "button", role: "menuitem", onclick: () => { close(); copyRuleTo(fromEnv, rule, to); } }, envLabel(to))));
  const onKey = (e) => { if (e.key === "Escape") { close(); button.focus(); } };
  const onDown = (e) => { if (!menu.contains(e.target) && !button.contains(e.target)) close(); };
  function close() {
    menu.remove();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("mousedown", onDown);
    closeMenu = null;
  }
  closeMenu = close;
  document.body.append(menu);
  const box = button.getBoundingClientRect();
  menu.style.top = `${box.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - menu.offsetWidth - 8))}px`;
  document.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", onDown);
  const first = menu.querySelector("button");
  if (first) first.focus();
}

function copyRuleTo(fromEnv, rule, toEnvArg) {
  const source = findRule(findEnv(fromEnv.id), rule.id);
  const toEnv = findEnv(toEnvArg.id);
  if (!source || !toEnv) return void gone();
  const copy = cloneRule(source);
  copy.name = source.name;
  if (toEnv.rules.some((r) => r.name === copy.name)) copy.name = `${source.name} (copy)`;
  toEnv.rules.push(copy);
  openEnvs.add(toEnv.id);
  save(); render();
  say(`Copied “${copy.name}” to ${envLabel(toEnv)}, paused.`);
  return copy;
}

async function importFile(file) {
  try {
    const parsed = Env.parseImport(await file.text());
    let domain = "";
    if (parsed.kind === "requestly") {
      const answer = await promptDialog({
        title: "Where does this herd graze?",
        body: "Enter the domain these rules apply to. Skip to park them until you decide.",
        label: "Domain",
        placeholder: "staging.myapp.com",
        validate: (value) => (value.trim() === "" || Env.isValidDomain(value) ? "" : INVALID_HINT),
      });
      if (answer === null) return say("Import cancelled.");
      domain = answer.value || "";
    }
    const { environments, summary } = Env.importIntoEnvironments(state.environments, parsed, { domain, filename: file.name });
    state.environments = environments;
    // Open every band that received rules (targets are domains, or names for parked bands).
    environments.forEach((env) => {
      if (summary.targets.includes(Env.isParked(env) ? env.name : env.domain)) openEnvs.add(env.id);
    });
    save(); render();
    const { added, replaced, skipped, targets } = summary;
    say(`Imported ${added} new, ${replaced} replaced into ${targets.join(", ")}${skipped ? `, ${skipped} skipped (not Response rules)` : ""}. All imported rules start paused.`);
  } catch (err) {
    say(`Import failed: ${err.message}`);
  }
}

function exportAll() {
  const blob = new Blob([JSON.stringify(Env.buildExport(state.environments), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: "mockingmoo-rules.json" });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ruleCard(env, rule) {
  const isOpen = open.has(key(env, rule));
  const active = rule.status === "Active";
  return h(
    "section",
    { class: `rule${isOpen ? " open" : ""}${active ? "" : " paused"}`, "data-id": rule.id, "aria-label": `Rule: ${rule.name}` },
    h(
      "div",
      { class: "head" },
      toggle(active, (on) => { rule.status = on ? "Active" : "Inactive"; save(); soon(render); }, "Rule active"),
      h(
        "div",
        { class: "title" },
        h("input", { type: "text", value: rule.name, "aria-label": "Rule name", oninput: (e) => { rule.name = e.target.value; save(); } }),
        h("span", { class: "summary", title: ruleSummary(rule) }, ruleSummary(rule))
      ),
      active
        ? h("span", { class: `badge ${ruleKind(rule)}` }, ruleKind(rule) === "static" ? "Static" : "JS rewrite")
        : h("span", { class: "badge paused" }, "Paused · out to pasture"),
      h(
        "div",
        { class: "tools" },
        h("button", { type: "button", class: "icon-btn", title: "Duplicate", "aria-label": "Duplicate rule", onclick: () => {
          const copy = cloneRule(rule);
          env.rules.splice(env.rules.indexOf(rule) + 1, 0, copy);
          open.add(key(env, copy));
          pending = { envId: env.id, ruleId: copy.id, kind: "enter" };
          save(); render();
        } }, icon("copy")),
        h("button", {
          type: "button", class: "icon-btn", title: state.environments.length > 1 ? "Copy to…" : "Only one environment",
          "aria-label": "Copy rule to another environment", "aria-haspopup": "menu", disabled: state.environments.length < 2,
          onclick: (e) => copyMenu(e.currentTarget, env, rule),
        }, icon("arrow")),
        h("button", { type: "button", class: "icon-btn", title: isOpen ? "Collapse" : "Edit", "aria-label": isOpen ? "Collapse rule" : "Edit rule", "aria-expanded": String(isOpen), onclick: () => expand(env, rule) }, h("span", { class: `chev${isOpen ? " flipped" : ""}` }, icon("down"))),
        h("button", { type: "button", class: "icon-btn danger", title: "Delete", "aria-label": "Delete rule", onclick: () => removeRule(env, rule) }, icon("trash"))
      )
    ),
    isOpen &&
      h(
        "div",
        { class: "body" },
        rule.pairs.map((pair, i) => pairEditor(rule, pair, i)),
        h("div", {}, h("button", { type: "button", class: "ghost", onclick: () => { rule.pairs.push(newPair()); save(); render(); } }, icon("plus"), "Add another URL match"))
      )
  );
}

function render() {
  const pills = capturePills();
  document.getElementById("global").replaceChildren(
    h("label", { class: `master${state.enabled ? "" : " off"}` },
      toggle(state.enabled, (on) => { state.enabled = on; Store.save({ enabled: on }); soon(render); }, "Enable mocking"),
      h("span", { class: "master-label" }, state.enabled ? "Mooing" : "Napping"))
  );

  const all = state.environments.flatMap((env) => env.rules);
  const counts = {
    all: all.length,
    active: all.filter((r) => r.status === "Active").length,
  };
  counts.paused = counts.all - counts.active;
  document.getElementById("filters").replaceWith(
    Object.assign(segmented({
      key: "filters",
      label: "Filter rules",
      value: filter,
      items: [["all", "All"], ["active", "Active"], ["paused", "Paused"]].map(([k, label]) => [k, `${label} · ${counts[k]}`]),
      onPick: (k) => { filter = k; settle = true; render(); },
    }), { id: "filters" })
  );

  const root = document.getElementById("environments");
  if (!state.environments.length) {
    root.replaceChildren(
      h("div", { class: "empty" },
        h("img", { src: "icons/logo-small.svg", alt: "", width: 72, height: 72 }),
        h("strong", {}, "The pasture is empty"),
        "Create an environment, or import a file.")
    );
  } else {
    root.replaceChildren(...state.environments.map(envBand));
  }
  placePills(pills);
  afterRender();
}

document.getElementById("add-env").addEventListener("click", () => addEnvironment({}));
document.getElementById("search-icon").replaceWith(icon("search"));
document.getElementById("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); settle = true; render(); });
document.getElementById("export").addEventListener("click", exportAll);
document.getElementById("import").addEventListener("click", () => document.getElementById("file").click());
document.getElementById("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) await importFile(file);
});

Store.load().then((loaded) => {
  state = loaded;
  state.environments.forEach((env) => openEnvs.add(env.id));
  // The popup opens options.html#new=<domain> to add a rule to that domain's environment straight away.
  if (location.hash.startsWith("#new=")) {
    const domain = safeDecode(location.hash.slice(5));
    history.replaceState(null, "", location.pathname);
    const env = Env.findByDomain(state.environments, domain) || addEnvironment({ domain, focus: false });
    addRuleTo(env);
  } else if (location.hash === "#new") {
    history.replaceState(null, "", location.pathname);
    addEnvironment({});
  } else {
    render();
  }
});

// Pick up changes made from the popup, but never re-render while the user is typing.
chrome.storage.onChanged.addListener(async () => {
  if (document.activeElement && document.activeElement.matches("input[type=text], input[type=number], textarea")) return;
  const fresh = await Store.load();
  // Our own saves echo back here; skip those so running animations aren't rebuilt mid-flight.
  if (fresh.enabled === state.enabled && JSON.stringify(fresh.environments) === JSON.stringify(state.environments)) return;
  state = fresh;
  render();
});
