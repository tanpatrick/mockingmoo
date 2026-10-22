const openOptions = (hash = "") =>
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash}`) }).then(() => window.close());

const calm = matchMedia("(prefers-reduced-motion: reduce)");
// Let a switch finish sliding before storage changes rebuild the popup.
const soon = (fn) => setTimeout(fn, calm.matches ? 0 : 170);
let firstPaint = true;

async function setRuleStatus(id, on) {
  const fresh = (await Store.load()).rules;
  const target = fresh.find((r) => r.id === id);
  if (target) target.status = on ? "Active" : "Inactive";
  Store.save({ rules: fresh });
}

async function render() {
  const { enabled, rules } = await Store.load();
  const active = rules.filter((r) => r.status === "Active").length;

  document.getElementById("master").replaceChildren(
    toggle(enabled, (on) => {
      document.querySelector(".card").classList.toggle("off", !on);
      soon(() => Store.save({ enabled: on }));
    }, enabled ? "Turn Mockingmoo off" : "Turn Mockingmoo on")
  );

  const status = h(
    "div",
    { class: `card${enabled ? "" : " off"}` },
    h("div", { class: "glyph" }, icon("bolt")),
    h(
      "div",
      {},
      h("strong", {}, enabled ? "Mooing on every tab" : "Napping: nothing is mocked"),
      h("span", {}, enabled
        ? `${active} of ${rules.length} rule${rules.length === 1 ? "" : "s"} active`
        : "Flip the switch to wake the herd")
    )
  );

  const list = rules.length
    ? h(
        "div",
        { class: "list" },
        rules.map((rule) => {
          const on = rule.status === "Active";
          return h(
            "div",
            { class: `row${on ? "" : " paused"}`, "data-id": rule.id },
            toggle(on, (v) => {
              document.querySelector(`.row[data-id="${rule.id}"]`).classList.toggle("paused", !v);
              soon(() => setRuleStatus(rule.id, v));
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
    : h("div", { class: "empty" }, h("strong", {}, "No cows yet"), "Add a rule or import some.");

  document.getElementById("root").replaceChildren(
    status,
    h(
      "div",
      { class: "step" },
      h("div", { class: "section-head" },
        h("h2", {}, "Your herd"),
        rules.length > 0 && h("button", { type: "button", class: "linkish", onclick: () => openOptions() }, "Edit")),
      list
    ),
    h("button", { type: "button", class: "primary wide", onclick: () => openOptions("#new") }, icon("plus"), "New rule")
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
manage.append(icon("list"), "Open all rules");
manage.addEventListener("click", () => openOptions());

render();
chrome.storage.onChanged.addListener(render);
