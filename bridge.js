// Isolated-world content script: relays rules from chrome.storage to inject.js (page world).
const DEFAULTS = { enabled: true, environments: [] };

const host = Env.pageHost(location);

const push = () =>
  chrome.storage.local.get(DEFAULTS).then((config) => {
    window.postMessage({ source: "mockingmoo:config", config: Env.rulesForPage(config, host) }, "*");
  });

push();

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") push();
});

window.addEventListener("message", (event) => {
  if (event.source === window && event.data && event.data.source === "mockingmoo:hello") push();
});
