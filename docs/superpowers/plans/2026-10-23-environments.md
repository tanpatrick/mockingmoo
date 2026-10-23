# Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group rules under environments tied to one exact domain each, so a rule fires only on the tab whose top-level page matches, and the same URL pattern can answer differently per domain.

**Architecture:** All pure logic (domain normalisation and matching, page-host detection, import parsing and merging, export shaping) moves into one new classic script, `environments.js`, that is loaded by the content script, the popup and the options page, and that also `module.exports` itself so Node's built-in test runner can test it with no dependencies. `bridge.js` uses it to send the page only the rules of the environments that match the tab. The options and popup pages re-render around environment bands using the existing `h`/`toggle`/`segmented`/`confirmDialog` helpers in `shared.js`. `inject.js` is untouched.

**Tech Stack:** Manifest V3 Chrome extension, vanilla JavaScript classic scripts (no bundler), `node --test` with `node:assert` for logic tests, Node 20+.

**Spec:** `docs/superpowers/specs/2026-10-23-environments-design.md`

## Global Constraints

- No build step. Every file is loaded unpacked from the repo as-is. No `import`/`export` syntax in extension files; `environments.js` guards `module.exports` with `typeof module !== "undefined"`.
- No new dependencies. Tests use only `node:test` and `node:assert/strict`.
- Manifest permissions become exactly `["storage", "activeTab"]`. Nothing else.
- `inject.js` keeps its contract: it receives `{ enabled, rules }` via `postMessage` and is not modified.
- Storage shape is `{ enabled: boolean, environments: Environment[] }`. The old `rules` key is never read.
- Environment: `{ id: string, domain: string, name: string, enabled: boolean, rules: Rule[] }`. `domain === ""` means parked. Rule objects keep today's shape unchanged.
- Domains are stored normalised: lowercase hostname, optional `:port`, default ports `:80` and `:443` stripped. Two non-parked environments never share a domain.
- A rule fires only when master `enabled`, the environment `enabled`, the rule `status === "Active"`, and the domain matches the tab's top-level page.
- Imported rules always arrive with `status: "Inactive"`.
- Copy voice stays in the herd register (mooing, napping, parked, pasture). Exact strings pinned in the spec are used verbatim.
- Commit after every task with a conventional-commit message in the repo's style and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A domain typed with scheme, path, uppercase or default port (`HTTPS://Staging.MyApp.com:443/`) must normalise to `staging.myapp.com` and match that site. Pinned in Task 1.
2. A cross-origin iframe inside a matching page must receive the parent's rules, and a matching page framed inside a non-matching site must receive none. Pinned in Task 1 (`pageHost`) and verified manually in Task 3.
3. Importing a Mockingmoo file whose environment domain already exists must merge into it, replacing same-id rules and appending others, never creating a duplicate domain. Pinned in Task 2.
4. Importing a plain Requestly file with `status: "Active"` must land paused, and when parked must never reach any page. Pinned in Tasks 2 and 1 respectively.
5. A tab whose URL is unreadable (`chrome://extensions`) must open the popup without throwing and without a create button. Pinned in Task 2 (`hostFromUrl` returns `null`) and verified manually in Task 7.

---

### Task 1: Test harness and domain matching logic

**Files:**
- Create: `environments.js`
- Create: `test/environments.test.js`
- Modify: `.github/workflows/build.yml` (add a test step to the `build` job before packaging)

**Interfaces:**
- Produces, as globals in the browser and `module.exports` in Node, an object `Env` with:
  - `normalizeDomain(input: string): string` → `""` for blank; otherwise lowercase hostname with optional `:port`, after stripping whitespace, a leading `scheme://`, anything from the first `/`, `?` or `#`, and a trailing `:80` or `:443`.
  - `pageHost(loc: { hostname: string, port: string, ancestorOrigins?: ArrayLike<string> }): { hostname: string, port: string }` → the top-level page's host: when `ancestorOrigins` has entries, parse its last entry with `new URL()`; otherwise use `loc` as-is. Hostname lowercased.
  - `domainMatches(domain: string, host: { hostname, port }): boolean` → `false` for `""`; a domain without a port matches the hostname on any port; a domain with a port matches only that port.
  - `isParked(env: Environment): boolean` → `env.domain === ""`.
  - `matchingEnvironments(environments: Environment[], host, opts?: { includeDisabled?: boolean }): Environment[]` → in array order, only those not parked and matching; environments with `enabled === false` are dropped unless `opts.includeDisabled` is true.
  - `rulesForPage(config: { enabled: boolean, environments: Environment[] }, host): { enabled: boolean, rules: Rule[] }` → `rules` is the concatenation of matching environments' rules; `enabled` passes through.
  - `createEnvironment({ domain?: string, name?: string }): Environment` → new id (8 hex chars like `newId` in options.js), normalised domain, `enabled: true`, `rules: []`.
  - `findByDomain(environments: Environment[], domain: string): Environment | undefined` → first non-parked environment whose domain equals `normalizeDomain(domain)`.
  - `suggestedDomain(host: { hostname, port }): string` → hostname plus `:port` when `port` is non-empty.

- [ ] **Step 1: Write the failing tests**

```js
// test/environments.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Env = require("../environments.js");

test("normalizeDomain strips scheme, path, case and default ports", () => {
  assert.equal(Env.normalizeDomain("  HTTPS://Staging.MyApp.com:443/path?x#y "), "staging.myapp.com");
  assert.equal(Env.normalizeDomain("http://localhost:3000/"), "localhost:3000");
  assert.equal(Env.normalizeDomain("myapp.com:80"), "myapp.com");
  assert.equal(Env.normalizeDomain("   "), "");
});

test("domainMatches: no port matches any port, explicit port matches only that port", () => {
  assert.equal(Env.domainMatches("localhost", { hostname: "localhost", port: "3000" }), true);
  assert.equal(Env.domainMatches("localhost:3000", { hostname: "localhost", port: "3000" }), true);
  assert.equal(Env.domainMatches("localhost:3000", { hostname: "localhost", port: "5173" }), false);
  assert.equal(Env.domainMatches("hello.com", { hostname: "www.hello.com", port: "" }), false);
  assert.equal(Env.domainMatches("", { hostname: "anything.com", port: "" }), false);
});

test("pageHost uses the top-level ancestor origin inside frames", () => {
  assert.deepEqual(Env.pageHost({ hostname: "widget.third.com", port: "", ancestorOrigins: ["https://staging.myapp.com"] }),
    { hostname: "staging.myapp.com", port: "" });
  assert.deepEqual(Env.pageHost({ hostname: "Staging.MyApp.com", port: "", ancestorOrigins: [] }),
    { hostname: "staging.myapp.com", port: "" });
  assert.deepEqual(Env.pageHost({ hostname: "localhost", port: "3000" }), { hostname: "localhost", port: "3000" });
});

test("rulesForPage sends only matching, enabled, non-parked environments' rules", () => {
  const r = (id) => ({ id, name: id, status: "Active", pairs: [] });
  const config = { enabled: true, environments: [
    { id: "a", domain: "localhost", name: "", enabled: true, rules: [r("a1")] },
    { id: "b", domain: "localhost:3000", name: "", enabled: true, rules: [r("b1")] },
    { id: "c", domain: "localhost:3000", name: "", enabled: false, rules: [r("c1")] },
    { id: "d", domain: "", name: "parked", enabled: true, rules: [r("d1")] },
    { id: "e", domain: "staging.myapp.com", name: "", enabled: true, rules: [r("e1")] },
  ] };
  const out = Env.rulesForPage(config, { hostname: "localhost", port: "3000" });
  assert.equal(out.enabled, true);
  assert.deepEqual(out.rules.map((x) => x.id), ["a1", "b1"]);
  assert.deepEqual(Env.rulesForPage(config, { hostname: "github.com", port: "" }).rules, []);
  const host = { hostname: "localhost", port: "3000" };
  assert.deepEqual(Env.matchingEnvironments(config.environments, host).map((e) => e.id), ["a", "b"]);
  assert.deepEqual(Env.matchingEnvironments(config.environments, host, { includeDisabled: true }).map((e) => e.id), ["a", "b", "c"]);
});

test("createEnvironment, isParked, findByDomain, suggestedDomain", () => {
  const e = Env.createEnvironment({ domain: "Staging.MyApp.com/" });
  assert.match(e.id, /^[0-9a-f]{8}$/);
  assert.deepEqual({ ...e, id: "x" }, { id: "x", domain: "staging.myapp.com", name: "", enabled: true, rules: [] });
  assert.equal(Env.isParked(Env.createEnvironment({})), true);
  assert.equal(Env.findByDomain([e], "staging.myapp.com"), e);
  assert.equal(Env.findByDomain([Env.createEnvironment({})], ""), undefined);
  assert.equal(Env.suggestedDomain({ hostname: "localhost", port: "3000" }), "localhost:3000");
  assert.equal(Env.suggestedDomain({ hostname: "staging.myapp.com", port: "" }), "staging.myapp.com");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/`
Expected: FAIL, `Cannot find module '../environments.js'`

- [ ] **Step 3: Implement `environments.js`**

Classic script: `const Env = { ... };` at top level (so it is a global in extension pages), ending with `if (typeof module !== "undefined") module.exports = Env;`. No reference to `chrome`, `document` or `window` anywhere in the file. `newId` logic is copied from options.js (the options.js copy is removed in Task 5).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/`
Expected: all 5 tests PASS

- [ ] **Step 5: Add the test step to CI**

In `.github/workflows/build.yml`, in the `build` job after checkout and before "Read version from manifest", add a step named "Run tests" using `actions/setup-node@<pinned sha for v4>` with `node-version: 20` followed by `run: node --test test/`. Pin the action to a commit SHA with a `# v4` comment, as the others are.

- [ ] **Step 6: Commit**

```bash
git add environments.js test/environments.test.js .github/workflows/build.yml
git commit -m "feat(env): domain matching logic with node tests"
```

---

### Task 2: Import and export logic

**Files:**
- Modify: `environments.js`
- Modify: `test/environments.test.js`

**Interfaces:**
- Consumes: Task 1's `Env.createEnvironment`, `Env.findByDomain`, `Env.normalizeDomain`.
- Produces on `Env`:
  - `normalizeRule(item: unknown): Rule | null` → the mapping currently inside `importRules` in options.js (`ruleType === "Response"`, `pairs` array required; defaults for `id`, `name`, `description`, pair `source`/`response`), except `status` is always `"Inactive"`. Returns `null` for anything that is not a Response rule.
  - `parseImport(text: string): { kind: "mockingmoo", environments: Array<{ domain: string, name: string, enabled: boolean, rules: Rule[] }> } | { kind: "requestly", rules: Rule[], skipped: number }` → throws the `JSON.parse` error on bad JSON; an object with `mockingmoo` and an `environments` array is a Mockingmoo file; an array or a single object is a Requestly file. In both kinds each rule passes through `normalizeRule`; non-rules are dropped and counted in `skipped` (for Mockingmoo files, `skipped` is summed onto the result as a top-level `skipped` too).
  - `importIntoEnvironments(environments: Environment[], parsed, opts: { domain?: string, filename: string }): { environments: Environment[], summary: { added: number, replaced: number, skipped: number, targets: string[] } }` → returns a new array (input not mutated). For `requestly`: target is `findByDomain(environments, opts.domain)` or a new environment with that domain prepended, or, when `opts.domain` is blank, a new parked environment appended with `name: opts.filename`. For `mockingmoo`: each file environment with a non-blank domain merges into the existing one with that domain (same-id rule replaced in place, others appended, `enabled` from file ignored) or is appended as new; each parked file environment is appended as a new parked environment with `name` from the file or `opts.filename` when blank. `targets` lists the label of each environment that received rules, in order, where label is `domain` or, for parked ones, `name`.
  - `buildExport(environments: Environment[]): { mockingmoo: 1, environments: Array<{ domain, name, enabled, rules }> }` → each rule is spread with `schemaVersion: "3.0.0"`, `ruleType: "Response"`, `groupId: ""`, `isSample: false`, exactly as `exportRules` in options.js does today. Environment `id` is not exported.
  - `hostFromUrl(url: string | undefined): { hostname: string, port: string } | null` → `null` when `url` is falsy, not parseable, or its protocol is not `http:`/`https:`; hostname lowercased.

- [ ] **Step 1: Write the failing tests**

```js
const requestlyRule = (id, status = "Active") => ({ id, name: id, ruleType: "Response", status,
  pairs: [{ id: id + "p", source: { key: "Url", operator: "Contains", value: "/api/" + id },
            response: { type: "static", value: "{}", statusCode: "200", serveWithoutRequest: true } }] });

test("normalizeRule forces Inactive and rejects non-Response items", () => {
  assert.equal(Env.normalizeRule(requestlyRule("x", "Active")).status, "Inactive");
  assert.equal(Env.normalizeRule({ ruleType: "Redirect", pairs: [] }), null);
  assert.equal(Env.normalizeRule(null), null);
});

test("parseImport detects Requestly arrays and Mockingmoo files", () => {
  const r = Env.parseImport(JSON.stringify([requestlyRule("a"), { ruleType: "Headers", pairs: [] }]));
  assert.equal(r.kind, "requestly"); assert.equal(r.rules.length, 1); assert.equal(r.skipped, 1);
  const m = Env.parseImport(JSON.stringify({ mockingmoo: 1, environments: [{ domain: "Local", name: "", enabled: false, rules: [requestlyRule("b")] }] }));
  assert.equal(m.kind, "mockingmoo"); assert.equal(m.environments[0].domain, "local");
  assert.throws(() => Env.parseImport("{nope"));
});

test("importIntoEnvironments: requestly file into a domain, or parked when skipped", () => {
  const parsed = Env.parseImport(JSON.stringify([requestlyRule("a")]));
  const withDomain = Env.importIntoEnvironments([], parsed, { domain: "staging.myapp.com", filename: "rules.json" });
  assert.equal(withDomain.environments[0].domain, "staging.myapp.com");
  assert.deepEqual(withDomain.summary, { added: 1, replaced: 0, skipped: 0, targets: ["staging.myapp.com"] });
  const parked = Env.importIntoEnvironments([], parsed, { domain: "", filename: "rules.json" });
  assert.equal(Env.isParked(parked.environments[0]), true);
  assert.equal(parked.environments[0].name, "rules.json");
  assert.deepEqual(parked.summary.targets, ["rules.json"]);
});

test("importIntoEnvironments: mockingmoo file merges by domain and never duplicates a domain", () => {
  const existing = [{ id: "e1", domain: "staging.myapp.com", name: "", enabled: true, rules: [Env.normalizeRule(requestlyRule("a")), Env.normalizeRule(requestlyRule("b"))] }];
  const file = { mockingmoo: 1, environments: [
    { domain: "staging.myapp.com", name: "", enabled: false, rules: [requestlyRule("b"), requestlyRule("c")] },
    { domain: "", name: "", enabled: true, rules: [requestlyRule("d")] },
  ] };
  const out = Env.importIntoEnvironments(existing, Env.parseImport(JSON.stringify(file)), { filename: "herd.json" });
  assert.equal(out.environments.length, 2);
  assert.equal(out.environments[0].enabled, true);
  assert.deepEqual(out.environments[0].rules.map((r) => r.id), ["a", "b", "c"]);
  assert.equal(out.environments[1].name, "herd.json");
  assert.deepEqual(out.summary, { added: 2, replaced: 1, skipped: 0, targets: ["staging.myapp.com", "herd.json"] });
  assert.equal(existing[0].rules.length, 2, "input not mutated");
});

test("buildExport round-trips and keeps rules Requestly-shaped", () => {
  const env = { id: "e1", domain: "localhost:3000", name: "", enabled: true, rules: [Env.normalizeRule(requestlyRule("a"))] };
  const out = Env.buildExport([env]);
  assert.equal(out.mockingmoo, 1);
  assert.equal("id" in out.environments[0], false);
  assert.equal(out.environments[0].rules[0].ruleType, "Response");
  assert.equal(out.environments[0].rules[0].schemaVersion, "3.0.0");
  assert.equal(Env.parseImport(JSON.stringify(out)).kind, "mockingmoo");
});

test("hostFromUrl", () => {
  assert.deepEqual(Env.hostFromUrl("https://Staging.MyApp.com/x"), { hostname: "staging.myapp.com", port: "" });
  assert.deepEqual(Env.hostFromUrl("http://localhost:3000/"), { hostname: "localhost", port: "3000" });
  assert.equal(Env.hostFromUrl("chrome://extensions"), null);
  assert.equal(Env.hostFromUrl(undefined), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/`
Expected: the six new tests FAIL with `Env.normalizeRule is not a function` and similar.

- [ ] **Step 3: Implement the six functions in `environments.js`**

`normalizeRule` is lifted from `importRules` in options.js. `importIntoEnvironments` deep-copies the input environments first (`JSON.parse(JSON.stringify(...))`) so callers can assign the result to state.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/`
Expected: all 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add environments.js test/environments.test.js
git commit -m "feat(env): import, export and merge logic"
```

---

### Task 3: Manifest and bridge send only the matching rules

**Files:**
- Modify: `manifest.json`
- Modify: `bridge.js`

**Interfaces:**
- Consumes: `Env.pageHost`, `Env.rulesForPage` from Task 1.
- Produces: the message `{ source: "mockingmoo:config", config: { enabled, rules } }` exactly as today, so `inject.js` is unchanged.

- [ ] **Step 1: Update `manifest.json`**

`"permissions": ["storage", "activeTab"]`. In the second content script entry, `"js": ["environments.js", "bridge.js"]`. The first entry (inject.js, MAIN world) is unchanged.

- [ ] **Step 2: Update `bridge.js`**

`DEFAULTS` becomes `{ enabled: true, environments: [] }`. Compute once at load `const host = Env.pageHost(location);` (pass `location` itself; `ancestorOrigins` is on it in Chrome). `push` posts `Env.rulesForPage(config, host)` instead of the raw config. The storage listener and hello handler stay as they are.

- [ ] **Step 3: Verify in the browser**

Load unpacked, reload the extension. Open DevTools on any `http(s)` page and run in the console (page world):

```js
window.addEventListener("message", (e) => e.data?.source === "mockingmoo:config" && console.log(e.data.config));
window.postMessage({ source: "mockingmoo:hello" }, "*");
```

Expected: a config object with `enabled` and an empty `rules` array (no environments exist yet), and no errors in the extension's service-worker or content-script consoles.

- [ ] **Step 4: Run tests**

Run: `node --test test/`
Expected: all PASS (nothing changed, this guards the shared file still loads in Node).

- [ ] **Step 5: Commit**

```bash
git add manifest.json bridge.js
git commit -m "feat(env): bridge sends the page only its environment's rules"
```

---

### Task 4: Shared store and dialogs

**Files:**
- Modify: `shared.js`
- Modify: `styles.css`

**Interfaces:**
- Produces:
  - `Store.load(): Promise<{ enabled: boolean, environments: Environment[] }>` (defaults change; `save` unchanged).
  - `promptDialog({ title, body, label, placeholder, confirmLabel, skipLabel }): Promise<{ value: string } | { skipped: true } | null>` → same visual family as `confirmDialog` (`.moo-dialog`), a single text input labelled `label`, three buttons: cancel (returns `null`), skip (returns `{ skipped: true }`), confirm (returns `{ value }` with the raw input; callers normalise). Enter in the input confirms; Escape cancels. Default labels: `confirmLabel = "Import here"`, `skipLabel = "Skip, park them"`.
  - `envLabel(env: Environment): string` → `env.domain` if non-blank, else `env.name` if non-blank, else `"Untitled"`.
  - `envSummary(env: Environment): string` → `"N rules · M active"` with singular `rule` when N is 1; parked environments append `" · parked"`.

- [ ] **Step 1: Implement in `shared.js`**

Change `Store.load` defaults. Add `promptDialog`, `envLabel`, `envSummary` beside `confirmDialog`. Reuse `confirmDialog`'s `finish` close animation pattern.

- [ ] **Step 2: Add dialog input styling to `styles.css`**

`.moo-dialog input[type=text]` styled like `.rule .title input` but with the full `2px solid var(--ink)` border always visible and `font-family: var(--mono)`. `.dialog-actions` gains a third button without changing the existing two.

- [ ] **Step 3: Verify in the browser**

From the options page console: `promptDialog({ title: "Which domain?", body: "x", label: "Domain", placeholder: "staging.myapp.com" }).then(console.log)`. Expected: dialog opens, Enter with text logs `{ value: "…" }`, the skip button logs `{ skipped: true }`, Escape logs `null`. Reduced-motion still closes immediately.

- [ ] **Step 4: Commit**

```bash
git add shared.js styles.css
git commit -m "feat(env): store defaults, prompt dialog and environment labels"
```

---

### Task 5: Rules page: environment bands

**Files:**
- Modify: `options.html`
- Modify: `options.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `Env.*` (Task 1), `Store`, `promptDialog`, `envLabel`, `envSummary`, `confirmDialog`, `h`, `toggle`, `segmented`, pills helpers (Task 4 and existing).
- Produces, in `options.js`, module-level `state = { enabled, environments }`, `openEnvs: Set<id>` (expanded bands; new bands and bands with open rules start expanded), and these functions used by Task 6:
  - `envBand(env: Environment): HTMLElement`
  - `addEnvironment({ domain = "", name = "", focus = true }): Environment` → `Env.createEnvironment`, **unshifted** onto `state.environments`, added to `openEnvs`, saved, rendered; with `focus`, the band's domain input receives focus.
  - `removeEnvironment(env)`, `setDomain(env, raw): boolean` (normalises; rejects duplicates with the hint "That domain already has an environment" shown under the input and reverts the field; returns whether it was applied).
  - `addRuleTo(env: Environment): Rule` → today's `addRule` logic, but unshifting onto `env.rules` and expanding the band.
  - `removeRule(env, rule)`, `ruleCard(env, rule)` (today's `ruleCard` with `env` threaded through so Duplicate and Delete act on `env.rules`).

- [ ] **Step 1: Restructure `options.html`**

Header actions become: master switch, **Import**, **Export**, **New environment** (`id="add-env"`, class `primary`). Keep `#file`, `#search`, `#filters`, `#msg`. Rename `<main id="rules">` to `<main id="environments">`.

- [ ] **Step 2: Rewrite the data layer in `options.js`**

Remove `newId`, `importRules`, `exportRules`, `addRule` and the global `state.rules` usage. Add the functions in the Interfaces block. `save()` persists `{ environments: state.environments }`. The storage `onChanged` listener compares `JSON.stringify(fresh.environments)`.

- [ ] **Step 3: Implement `envBand`**

Band structure (`section.env[data-env-id]`, class `parked` when `Env.isParked(env)`, class `off` when `!env.enabled`, class `open` when expanded):
- `.env-head`: `toggle(env.enabled, …, "Environment active")`, a `.title` block with the domain `input.mono` (placeholder `hello.com`, `aria-label: "Environment domain"`, commits on `change`/blur via `setDomain`) and a small name `input` (placeholder `Name (optional)`, `aria-label: "Environment name"`), a `.summary` from `envSummary`, a `badge parked` reading **Parked · not applied anywhere** when parked, then `.tools`: **+ Rule** (`addRuleTo`), collapse chevron (same `aria-expanded` pattern as rule cards), Delete (`confirmDialog` titled `Delete “<envLabel>”?` with body `This takes N rule(s) with it. Export first if you might want them back.`).
- `.env-body` (only when open): the environment's rules filtered by search and filter pills, rendered with `ruleCard(env, rule)`; if the environment has no rules at all, an `.empty` reading **No rules here.** / `This domain stays real until you say otherwise.`; if it has rules but none pass the filter, **No cows match** / `Try another search or filter.`.

Under the domain input, a `.hint` that reads `Add a domain. Until then this environment is parked and mocks nothing.` when parked, and the duplicate hint from `setDomain` when rejected.

- [ ] **Step 4: Implement `render()`**

Master switch and filter pills as today, with counts computed across all environments. Page-level empty state when `state.environments.length === 0`: the existing logo + **The pasture is empty** / `Create an environment, or import a file.` Otherwise every environment band in order, regardless of search (bands never disappear; a band whose rules are all filtered out shows its "No cows match" body when open). Search matches rule name, URL pattern, environment domain and environment name.

- [ ] **Step 5: Styles**

In `styles.css` add `.env`, `.env-head`, `.env.parked` (dashed `var(--dash)` border like `.rule.paused`), `.env.off` (muted like `.master.off`), `.env-body` (padding 14px, `display:flex; flex-direction:column; gap:12px`), `.badge.parked` (transparent with `var(--dash)` border). Rule cards inside a band keep their existing styles.

- [ ] **Step 6: Verify in the browser**

Reload the extension, open the rules page. Check: (a) empty state shows; (b) **New environment** adds a parked band at the top with the domain input focused; (c) typing `HTTPS://Staging.MyApp.com/` and blurring stores `staging.myapp.com` and the parked badge disappears; (d) a second environment given the same domain shows the duplicate hint and reverts; (e) **+ Rule** adds a rule inside the band; (f) Delete on the band asks with the rule count and removes it; (g) on a tab at that domain, the DevTools check from Task 3 Step 3 now lists the rule; on another domain it lists nothing.

- [ ] **Step 7: Run tests and commit**

Run: `node --test test/` → all PASS.

```bash
git add options.html options.js styles.css
git commit -m "feat(env): rules page groups rules under environment bands"
```

---

### Task 6: Rules page: Copy to…, import, export, and `#new=`

**Files:**
- Modify: `options.js`
- Modify: `shared.js` (one icon)

**Interfaces:**
- Consumes: Task 5's `ruleCard(env, rule)`, `addEnvironment`, `addRuleTo`, `openEnvs`; Task 2's `Env.parseImport`, `Env.importIntoEnvironments`, `Env.buildExport`, `Env.findByDomain`; Task 4's `promptDialog`.
- Produces: `copyRuleTo(fromEnv, rule, toEnv)`, `importFile(file: File)`, `exportAll()`, and `#new=<domain>` handling on load.

- [ ] **Step 1: Copy to…**

Add an icon `ICONS.arrow` (a right arrow on the 24-grid) in `shared.js`. In `ruleCard`, beside Duplicate, a **Copy to…** `icon-btn` that opens a small `<div class="menu" role="menu">` positioned under the button listing every other environment by `envLabel` (disabled with title `Only one environment` when there are none). Choosing one calls `copyRuleTo`: deep-copies the rule with fresh ids via `Env`-free `cloneRule` (keep the existing helper, make it accept `rule` and return a copy with `status: "Inactive"`), suffixes ` (copy)` only if a rule with the same name already exists in `toEnv`, pushes onto `toEnv.rules`, opens that band, saves, renders, and says `Copied “<name>” to <envLabel(toEnv)>, paused.` Menu closes on Escape, outside click, or choice.

- [ ] **Step 2: Import**

`#file` change handler reads the file text, calls `Env.parseImport`. For `kind === "requestly"`, await `promptDialog({ title: "Where does this herd graze?", body: "Enter the domain these rules apply to. Skip to park them until you decide.", label: "Domain", placeholder: "staging.myapp.com" })`; `null` aborts with `say("Import cancelled.")`. Then `Env.importIntoEnvironments(state.environments, parsed, { domain: value or "", filename: file.name })`, assign `state.environments`, open the target bands, save, render. Status copy: `Imported ${added} new, ${replaced} replaced into ${targets.join(", ")}${skipped ? `, ${skipped} skipped (not Response rules)` : ""}. All imported rules start paused.` Bad JSON: `say(\`Import failed: ${err.message}\`)` as today.

- [ ] **Step 3: Export**

`exportAll` downloads `JSON.stringify(Env.buildExport(state.environments), null, 2)` as `mockingmoo-rules.json`.

- [ ] **Step 4: `#new=` on load**

On `Store.load`, if `location.hash` starts with `#new=`: `const domain = decodeURIComponent(hash.slice(5))`; `env = Env.findByDomain(state.environments, domain) || addEnvironment({ domain, focus: false })`; then `addRuleTo(env)`; `history.replaceState(null, "", location.pathname)`. A bare `#new` (no `=`) behaves as `addEnvironment({})`.

- [ ] **Step 5: Verify in the browser**

(a) Import the current `examples/sample-rules.json` (still a Requestly array at this point): dialog appears; enter `localhost:3000` → band created, 4 paused rules, status line names the target. Import again and skip → a parked band named `sample-rules.json`. (b) Export → file opens with `mockingmoo: 1`; re-import it → merges with no duplicate domain. (c) Copy a rule to another environment → appears paused there, name suffixed only on collision. (d) Open `options.html#new=staging.myapp.com` → environment created at top, expanded, with a fresh rule.

- [ ] **Step 6: Run tests and commit**

Run: `node --test test/` → all PASS.

```bash
git add options.js shared.js
git commit -m "feat(env): copy rules between environments, import with domain prompt, export environments"
```

---

### Task 7: Popup knows the tab

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `Env.hostFromUrl`, `Env.matchingEnvironments`, `Env.suggestedDomain`, `envLabel`, `Store`, `toggle`, `h`, `icon`.
- Produces: nothing used elsewhere.

- [ ] **Step 1: Load `environments.js` in `popup.html`** before `shared.js`. Footer button text becomes **Open all environments**.

- [ ] **Step 2: Rewrite `render()` in `popup.js`**

Once at startup: `const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const host = Env.hostFromUrl(tab && tab.url);`. Then per render, with `{ enabled, environments }` from `Store.load()`:
- `matches = host ? Env.matchingEnvironments(environments, host, { includeDisabled: true }) : []`, so a switched-off environment still shows as the tab's environment.
- For each match, a `.card` (green `on` when `enabled && env.enabled`, `off` otherwise) containing the environment's `toggle` (saves `env.enabled`), `envLabel(env)` in mono, and the line `Mooing here · N of M rules active` or `Environment paused · nothing is mocked here` (or `Napping` when the master is off, as today). Below it, that environment's rule rows (existing row markup, dimmed via class `paused` on the whole list when the environment is off), then **+ New rule here** → `openOptions(\`#new=${encodeURIComponent(env.domain)}\`)`.
- No match and `host`: muted `.card.none` with `Env.suggestedDomain(host)` in mono and `No environment here, so nothing is mocked.`, then **+ Make <domain> an environment** → `openOptions(\`#new=${encodeURIComponent(Env.suggestedDomain(host))}\`)`.
- No `host`: the same muted card reading `This tab can't be mocked.` with no create button.
- Always, at the bottom in `.sub` style: `${environments.length} environment(s) · ${total} rule(s) in total`.

`setRuleStatus(envId, ruleId, on)` replaces the current `setRuleStatus(id, on)`.

- [ ] **Step 3: Styles**

`.popup .card.none` (background `var(--paused)`), `.popup .card .dom` (mono, bold), `.popup .list.paused .row` (opacity .55).

- [ ] **Step 4: Verify in the browser**

(a) On `http://localhost:3000` with a matching environment: card, switch, rules, **+ New rule here** opens the rules page with a fresh rule in that environment. Flip the card's switch off → text changes to paused, rows dim, DevTools config check shows no rules. (b) On `github.com` with no environment: muted card, create button opens `#new=github.com`. (c) On `chrome://extensions`: muted card, no create button, no console errors. (d) Master switch off → `Napping` copy as today.

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.js styles.css
git commit -m "feat(env): popup shows the current tab's environment"
```

---

### Task 8: Sample file, docs and screenshots

**Files:**
- Modify: `examples/sample-rules.json`
- Modify: `README.md`
- Modify: `docs/popup.png`, `docs/rules.png`, `docs/editor.png` (retake)
- Modify: `test/environments.test.js` (one test)

- [ ] **Step 1: Write the failing test**

```js
test("the shipped sample file is a Mockingmoo file with one parked environment", () => {
  const text = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "examples", "sample-rules.json"), "utf8");
  const parsed = Env.parseImport(text);
  assert.equal(parsed.kind, "mockingmoo");
  assert.equal(parsed.environments.length, 1);
  assert.equal(parsed.environments[0].domain, "");
  assert.equal(parsed.environments[0].name, "Sample herd");
  assert.equal(parsed.environments[0].rules.length, 4);
});
```

Run: `node --test test/` → this test FAILS (`kind` is `requestly`).

- [ ] **Step 2: Convert `examples/sample-rules.json`**

Wrap the existing four rules: `{ "mockingmoo": 1, "environments": [{ "domain": "", "name": "Sample herd", "enabled": true, "rules": [ …the four rules unchanged… ] }] }`.

Run: `node --test test/` → all PASS.

- [ ] **Step 3: README**

- Quick start becomes: Open all environments → Import `examples/sample-rules.json` (arrives as a parked "Sample herd") → type the domain of the site you'll test on into its band (for the DevTools demo, the domain of whatever page you have open) → switch **Static: users list** on → check the popup says **Mooing here** → run the fetch.
- New section **Environments** after the screenshots: one environment per exact domain (`hello.com` is not `www.hello.com`; `localhost` matches any port, `localhost:3000` only that one); the match is the page in the tab, including anything framed inside it; parked environments mock nothing; the three switches; **Copy to…** for the same path with a different body.
- **Import Requestly rules, export your own**: describe the domain prompt and the skip-to-park behaviour; export now carries environments, and each environment's `rules` array is still a valid Requestly import.
- Limitations: the "pages can read your rules" entry becomes "the rules of the environment that matches the page"; add "Permissions: `storage` and `activeTab`. The latter only lets the popup see the address of the tab you clicked the icon on."
- Comparison table row "What it covers" for Mockingmoo becomes "Response mocking and rewriting, grouped per domain".

- [ ] **Step 4: Retake the three screenshots** at the same widths as the current ones, with the sample herd imported into `localhost:3000` and a second environment `staging.myapp.com` holding a copied `/api/users` rule, so the per-domain idea is visible.

- [ ] **Step 5: Commit**

```bash
git add examples/sample-rules.json README.md docs/*.png test/environments.test.js
git commit -m "docs: environments in the sample file, README and screenshots"
```
