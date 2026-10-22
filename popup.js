const openOptions = (hash = "") =>
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash}`) }).then(() => window.close());

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
    toggle(enabled, (on) => Store.save({ enabled: on }), enabled ? "Turn Mockingmoo off" : "Turn Mockingmoo on")
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
            { class: `row${on ? "" : " paused"}` },
            toggle(on, (v) => setRuleStatus(rule.id, v), `${rule.name} active`, "sm"),
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
}

const manage = document.getElementById("manage");
manage.append(icon("list"), "Open all rules");
manage.addEventListener("click", () => openOptions());

render();
chrome.storage.onChanged.addListener(render);
