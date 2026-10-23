// Isolated-world content script: relays rules from chrome.storage to inject.js (page world).
const DEFAULTS = { enabled: true, environments: [] };

const host = Env.pageHost(location);

const post = (config) => window.postMessage({ source: "mockingmoo:config", config }, "*");

// Whatever is in storage, always answer: inject.js should not wait out its fail-open timer on corrupt data.
const push = () =>
  chrome.storage.local
    .get(DEFAULTS)
    .then((config) => post(Env.rulesForPage(config, host)))
    .catch(() => post({ enabled: false, rules: [] }));

push();

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") push();
});

window.addEventListener("message", (event) => {
  if (event.source === window && event.data && event.data.source === "mockingmoo:hello") push();
});
