// Isolated-world content script: relays rules from chrome.storage to inject.js (page world).
const DEFAULTS = { enabled: true, rules: [] };

const push = () =>
  chrome.storage.local.get(DEFAULTS).then((config) => {
    window.postMessage({ source: "ft-mocker:config", config }, "*");
  });

push();

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") push();
});

window.addEventListener("message", (event) => {
  if (event.source === window && event.data && event.data.source === "ft-mocker:hello") push();
});
