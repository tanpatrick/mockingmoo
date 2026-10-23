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

test("pageHost falls back to a host that matches nothing on an opaque ancestor origin", () => {
  assert.deepEqual(Env.pageHost({ hostname: "widget.third.com", port: "", ancestorOrigins: ["null"] }), { hostname: "", port: "" });
  assert.equal(Env.domainMatches("widget.third.com", Env.pageHost({ hostname: "widget.third.com", port: "", ancestorOrigins: ["null"] })), false);
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
  for (let i = 0; i < 50; i++) assert.match(Env.createEnvironment({}).id, /^[0-9a-f]{8}$/);
  assert.deepEqual({ ...e, id: "x" }, { id: "x", domain: "staging.myapp.com", name: "", enabled: true, rules: [] });
  assert.equal(Env.isParked(Env.createEnvironment({})), true);
  assert.equal(Env.findByDomain([e], "staging.myapp.com"), e);
  assert.equal(Env.findByDomain([Env.createEnvironment({})], ""), undefined);
  assert.equal(Env.suggestedDomain({ hostname: "localhost", port: "3000" }), "localhost:3000");
  assert.equal(Env.suggestedDomain({ hostname: "staging.myapp.com", port: "" }), "staging.myapp.com");
});

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

test("rulesForPage ignores an environment with no rules array", () => {
  const config = { enabled: true, environments: [{ id: "x", domain: "localhost", name: "", enabled: true }] };
  assert.deepEqual(Env.rulesForPage(config, { hostname: "localhost", port: "" }).rules, []);
});
