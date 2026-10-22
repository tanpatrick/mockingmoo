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
  } catch (err) {
    note.textContent = err.message.split("\n")[0];
  }
}

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
          oninput: (e) => { source.value = e.target.value; save(); },
        }),
        many &&
          h("button", {
            type: "button", class: "ghost icon-btn", "aria-label": "Remove this URL match", title: "Remove this URL match",
            onclick: () => { rule.pairs = rule.pairs.filter((p) => p !== pair); save(); render(); },
          }, icon("x"))
      )
    ),
    h(
      "div",
      { class: "step" },
      h("div", { class: "step-label" }, h("span", { class: "num" }, many ? `${index + 1}b` : "2"), "…then moo back with"),
      h(
        "div",
        { class: "tabs", role: "tablist", "aria-label": "Response type" },
        TYPES.map(([v, label]) =>
          h("button", { type: "button", role: "tab", "aria-selected": String(response.type === v), onclick: () => setType(response, v) }, label)
        )
      ),
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
          ". Return a string or an object.")
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
  const flip = () => { isOpen ? open.delete(rule.id) : open.add(rule.id); render(); };
  return h(
    "section",
    { class: `rule${isOpen ? " open" : ""}${active ? "" : " paused"}`, "aria-label": `Rule: ${rule.name}` },
    h(
      "div",
      { class: "head" },
      toggle(active, (on) => { rule.status = on ? "Active" : "Inactive"; save(); render(); }, "Rule active"),
      h(
        "div",
        { class: "title" },
        h("input", { type: "text", value: rule.name, "aria-label": "Rule name", oninput: (e) => { rule.name = e.target.value; save(); } }),
        !isOpen && h("span", { class: "summary", title: ruleSummary(rule) }, ruleSummary(rule))
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
          save(); render();
        } }, icon("copy")),
        h("button", { type: "button", class: "icon-btn", title: isOpen ? "Collapse" : "Edit", "aria-label": isOpen ? "Collapse rule" : "Edit rule", "aria-expanded": String(isOpen), onclick: flip }, icon(isOpen ? "up" : "down")),
        h("button", { type: "button", class: "icon-btn danger", title: "Delete", "aria-label": "Delete rule", onclick: () => {
          if (!confirm(`Delete "${rule.name}"?`)) return;
          state.rules = state.rules.filter((r) => r !== rule);
          save(); render();
        } }, icon("trash"))
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
  document.getElementById("global").replaceChildren(
    h("label", { class: `master${state.enabled ? "" : " off"}` },
      toggle(state.enabled, (on) => { state.enabled = on; Store.save({ enabled: on }); render(); }, "Enable mocking"),
      state.enabled ? "Mooing" : "Napping")
  );

  const counts = {
    all: state.rules.length,
    active: state.rules.filter((r) => r.status === "Active").length,
  };
  counts.paused = counts.all - counts.active;
  document.getElementById("filters").replaceChildren(
    ...[["all", "All"], ["active", "Active"], ["paused", "Paused"]].map(([key, label]) =>
      h("button", { type: "button", "aria-pressed": String(filter === key), onclick: () => { filter = key; render(); } }, `${label} · ${counts[key]}`)
    )
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
  query = "";
  filter = "all";
  document.getElementById("search").value = "";
  save(); render();
}

document.getElementById("add").addEventListener("click", addRule);
document.getElementById("search-icon").replaceWith(icon("search"));
document.getElementById("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); render(); });
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
  state = await Store.load();
  render();
});
