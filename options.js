const OPERATORS = [
  ["Contains", "URL contains"],
  ["Equals", "URL equals"],
  ["Matches", "URL matches regex"],
  ["Wildcard_Matches", "URL matches wildcard (*)"],
];

const CODE_TEMPLATE = `function modifyResponse({ url, method, requestData, response, responseJSON, statusCode }) {
  // Return the new response body (string or object).
  return response;
}
`;

let state = { enabled: true, rules: [] };
const open = new Set();
let saveTimer;

const newId = () => Math.random().toString(16).slice(2, 10);
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
  saveTimer = setTimeout(() => Store.save({ rules: state.rules }), 250);
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
let pending = null;  // { id, kind: "expand" | "enter" } to play after the next render
let settle = true;   // fade the list in on the next render (load, search, filter)

const cardEl = (id) => document.querySelector(`.rule[data-id="${id}"]`);
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
    const card = cardEl(job.id);
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
    [...document.getElementById("rules").children].slice(0, 12).forEach((el, i) =>
      play(el, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: i * 30, fill: "backwards" })
    );
  }
}

async function expand(rule) {
  if (busy) return;
  busy = true;
  if (open.has(rule.id)) {
    const card = cardEl(rule.id);
    const body = card && card.querySelector(".body");
    if (body) {
      body.style.overflow = "hidden";
      await Promise.all([
        play(body, heightFrames(body, false), { duration: 220, fill: "forwards" }),
        play(card.querySelector(".chev"), [{ transform: "rotate(180deg)" }, { transform: "rotate(0deg)" }], { duration: 220, fill: "forwards" }),
      ]);
    }
    open.delete(rule.id);
  } else {
    open.add(rule.id);
    pending = { id: rule.id, kind: "expand" };
  }
  busy = false;
  render();
}

async function removeRule(rule) {
  const ok = await confirmDialog({
    title: `Delete “${rule.name || "Untitled rule"}”?`,
    body: "This cow leaves the herd for good. Export first if you might want it back.",
    confirmLabel: "Delete rule",
  });
  if (!ok) return;
  const card = cardEl(rule.id);
  if (card) {
    card.style.overflow = "hidden";
    await play(card, [
      { height: `${card.offsetHeight}px`, opacity: 1, transform: "none", marginBottom: "0px" },
      { height: `${card.offsetHeight}px`, opacity: 0, transform: "translateX(24px) rotate(1deg)", marginBottom: "0px", offset: 0.55 },
      { height: "0px", opacity: 0, transform: "translateX(24px)", marginBottom: "-16px", borderWidth: "0px" },
    ], { duration: 340, fill: "forwards" });
  }
  state.rules = state.rules.filter((r) => r !== rule);
  open.delete(rule.id);
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
  copy.pairs.forEach((p) => (p.id = newId()));
  return copy;
}

function ruleCard(rule) {
  const isOpen = open.has(rule.id);
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
          state.rules.splice(state.rules.indexOf(rule) + 1, 0, copy);
          open.add(copy.id);
          pending = { id: copy.id, kind: "enter" };
          save(); render();
        } }, icon("copy")),
        h("button", { type: "button", class: "icon-btn", title: isOpen ? "Collapse" : "Edit", "aria-label": isOpen ? "Collapse rule" : "Edit rule", "aria-expanded": String(isOpen), onclick: () => expand(rule) }, h("span", { class: `chev${isOpen ? " flipped" : ""}` }, icon("down"))),
        h("button", { type: "button", class: "icon-btn danger", title: "Delete", "aria-label": "Delete rule", onclick: () => removeRule(rule) }, icon("trash"))
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

function matchesQuery(rule) {
  if (!query) return true;
  const hay = [rule.name, ...(rule.pairs || []).map((p) => p.source.value)].join(" ").toLowerCase();
  return hay.includes(query);
}

function render() {
  const pills = capturePills();
  document.getElementById("global").replaceChildren(
    h("label", { class: `master${state.enabled ? "" : " off"}` },
      toggle(state.enabled, (on) => { state.enabled = on; Store.save({ enabled: on }); soon(render); }, "Enable mocking"),
      h("span", { class: "master-label" }, state.enabled ? "Mooing" : "Napping"))
  );

  const counts = {
    all: state.rules.length,
    active: state.rules.filter((r) => r.status === "Active").length,
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

  const shown = state.rules.filter(
    (r) => matchesQuery(r) && (filter === "all" || (filter === "active") === (r.status === "Active"))
  );
  const root = document.getElementById("rules");
  if (!state.rules.length) {
    root.replaceChildren(
      h("div", { class: "empty" },
        h("img", { src: "icons/logo-small.svg", alt: "", width: 72, height: 72 }),
        h("strong", {}, "The pasture is empty"),
        "Create a rule, or import a Requestly export.")
    );
  } else if (!shown.length) {
    root.replaceChildren(h("div", { class: "empty" }, h("strong", {}, "No cows match"), "Try another search or filter."));
  } else {
    root.replaceChildren(...shown.map(ruleCard));
  }
  placePills(pills);
  afterRender();
}

function importRules(text) {
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  for (const item of items) {
    if (!item || item.ruleType !== "Response" || !Array.isArray(item.pairs)) {
      skipped++;
      continue;
    }
    const rule = {
      id: item.id || newId(),
      name: item.name || "Imported rule",
      description: item.description || "",
      status: item.status === "Active" ? "Active" : "Inactive",
      pairs: item.pairs.map((p) => ({
        id: p.id || newId(),
        source: { key: p.source.key || "Url", operator: p.source.operator || "Contains", value: p.source.value || "" },
        response: {
          type: p.response.type === "static" ? "static" : "code",
          value: p.response.value || "",
          statusCode: p.response.statusCode || "200",
          serveWithoutRequest: p.response.serveWithoutRequest !== false,
        },
      })),
    };
    const index = state.rules.findIndex((r) => r.id === rule.id);
    if (index >= 0) { state.rules[index] = rule; replaced++; } else { state.rules.push(rule); added++; }
  }
  Store.save({ rules: state.rules });
  render();
  say(`Imported ${added} new, ${replaced} replaced${skipped ? `, ${skipped} skipped (not Response rules)` : ""}.`);
}

function exportRules() {
  const data = state.rules.map((rule) => ({
    ...rule,
    schemaVersion: "3.0.0",
    ruleType: "Response",
    groupId: "",
    isSample: false,
  }));
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  h("a", { href: url, download: "mock-rules.json" }).click();
  URL.revokeObjectURL(url);
}

function addRule() {
  const rule = { id: newId(), name: "New rule", description: "", status: "Active", pairs: [newPair()] };
  state.rules.unshift(rule);
  open.add(rule.id);
  pending = { id: rule.id, kind: "enter" };
  query = "";
  filter = "all";
  document.getElementById("search").value = "";
  save(); render();
}

document.getElementById("add").addEventListener("click", addRule);
document.getElementById("search-icon").replaceWith(icon("search"));
document.getElementById("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); settle = true; render(); });
document.getElementById("export").addEventListener("click", exportRules);
document.getElementById("import").addEventListener("click", () => document.getElementById("file").click());
document.getElementById("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    importRules(await file.text());
  } catch (err) {
    say(`Import failed: ${err.message}`);
  }
});

Store.load().then((loaded) => {
  state = loaded;
  // The popup opens options.html#new to start a rule straight away.
  if (location.hash === "#new") {
    history.replaceState(null, "", location.pathname);
    addRule();
  } else {
    render();
  }
});

// Pick up changes made from the popup, but never re-render while the user is typing.
chrome.storage.onChanged.addListener(async () => {
  if (document.activeElement && document.activeElement.matches("input[type=text], input[type=number], textarea")) return;
  const fresh = await Store.load();
  // Our own saves echo back here; skip those so running animations aren't rebuilt mid-flight.
  if (fresh.enabled === state.enabled && JSON.stringify(fresh.rules) === JSON.stringify(state.rules)) return;
  state = fresh;
  render();
});
