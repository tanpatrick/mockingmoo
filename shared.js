const Store = {
  load: () => chrome.storage.local.get({ enabled: true, rules: [] }),
  save: (patch) => chrome.storage.local.set(patch),
};

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...kids.flat().filter((kid) => kid != null && kid !== false));
  return el;
}

function toggle(checked, onchange, label, size = "") {
  return h(
    "label",
    { class: `switch ${size}`.trim(), title: label },
    h("input", { type: "checkbox", checked, "aria-label": label, onchange: (e) => onchange(e.target.checked) }),
    h("span", { class: "slider" })
  );
}

// Stroke icons, drawn on a 24x24 grid.
const ICONS = {
  plus: "M12 5v14M5 12h14",
  upload: "M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  download: "M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  copy: "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  x: "M6 6l12 12M18 6L6 18",
  list: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 9h18M9 9v11",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
};

function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

const OPERATOR_SHORT = { Contains: "contains", Equals: "equals", Matches: "matches", Wildcard_Matches: "wildcard" };

// One-line description of a rule, e.g. "contains /api/users → JS rewrite".
function ruleSummary(rule) {
  const pairs = rule.pairs || [];
  if (!pairs.length) return "No URL matches yet";
  const { source, response } = pairs[0];
  const what = response.type === "static" ? `static ${response.statusCode || 200}` : "JS rewrite";
  const more = pairs.length > 1 ? `  +${pairs.length - 1} more` : "";
  return `${OPERATOR_SHORT[source.operator] || source.operator} ${source.value || "(any URL)"} → ${what}${more}`;
}

function ruleKind(rule) {
  const types = new Set((rule.pairs || []).map((p) => p.response.type));
  return types.size === 1 && types.has("static") ? "static" : "code";
}
