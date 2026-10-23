const test = require("node:test");
const assert = require("node:assert/strict");
const Env = require("../environments.js");

test("normalizeDomain strips scheme, path and case, and keeps explicit ports as typed", () => {
  assert.equal(Env.normalizeDomain("  HTTPS://Staging.MyApp.com:443/path?x#y "), "staging.myapp.com:443");
  assert.equal(Env.normalizeDomain("HTTPS://Staging.MyApp.com/x"), "staging.myapp.com");
  assert.equal(Env.normalizeDomain("http://localhost:3000/"), "localhost:3000");
  assert.equal(Env.normalizeDomain("localhost:3000"), "localhost:3000");
  assert.equal(Env.normalizeDomain("myapp.com:80"), "myapp.com:80");
  assert.equal(Env.normalizeDomain("  a.com  "), "a.com");
  assert.equal(Env.normalizeDomain("www.hello.com"), "www.hello.com");
  assert.equal(Env.normalizeDomain("   "), "");
  assert.equal(Env.normalizeDomain(undefined), "");
});

test("normalizeDomain returns null for anything that is not a bare hostname with an optional port", () => {
  for (const bad of ["*.myapp.com", "user@a.com", "a.com:abc", "a.com:", "[::1]:3000", "staging myapp.com", "a..com", "-a.com", "a.com:123456"]) {
    assert.equal(Env.normalizeDomain(bad), null, bad);
    assert.equal(Env.isValidDomain(bad), false, bad);
  }
  assert.equal(Env.isValidDomain("staging.myapp.com"), true);
  assert.equal(Env.isValidDomain("localhost:3000"), true);
  assert.equal(Env.isValidDomain(""), false);
});

test("normalizeDomain converts internationalised names to punycode", () => {
  assert.equal(Env.normalizeDomain("münchen.de"), "xn--mnchen-3ya.de");
  assert.equal(Env.normalizeDomain("https://München.de:8080/x"), "xn--mnchen-3ya.de:8080");
  assert.equal(Env.normalizeDomain("mün chen.de"), null);
});

test("createEnvironment and importing refuse invalid domains instead of storing null", () => {
  assert.throws(() => Env.createEnvironment({ domain: "*.myapp.com" }));
  assert.equal(Env.findByDomain([Env.createEnvironment({ domain: "a.com" })], "*.a.com"), undefined);
  assert.throws(() => Env.parseImport(JSON.stringify({ mockingmoo: 1, environments: [{ domain: "a b.com", rules: [] }] })));
  const parsed = Env.parseImport(JSON.stringify([requestlyRule("a")]));
  assert.throws(() => Env.importIntoEnvironments([], parsed, { domain: "user@a.com", filename: "f.json" }));
});

test("suggestedDomain always passes validation", () => {
  for (const host of [{ hostname: "localhost", port: "3000" }, { hostname: "staging.myapp.com", port: "" }, { hostname: "127.0.0.1", port: "8080" }]) {
    assert.equal(Env.isValidDomain(Env.suggestedDomain(host)), true, Env.suggestedDomain(host));
    assert.equal(Env.normalizeDomain(Env.suggestedDomain(host)), Env.suggestedDomain(host));
  }
});

test("domainMatches: no port matches any port, explicit port matches only that port", () => {
  assert.equal(Env.domainMatches("localhost", { hostname: "localhost", port: "3000" }), true);
  assert.equal(Env.domainMatches("localhost:3000", { hostname: "localhost", port: "3000" }), true);
  assert.equal(Env.domainMatches("localhost:3000", { hostname: "localhost", port: "5173" }), false);
  assert.equal(Env.domainMatches("hello.com", { hostname: "www.hello.com", port: "" }), false);
  assert.equal(Env.domainMatches("", { hostname: "anything.com", port: "" }), false);
});

test("domainMatches: an explicit default port matches the browser's empty port, never a different one", () => {
  assert.equal(Env.domainMatches("localhost:443", { hostname: "localhost", port: "3000" }), false);
  assert.equal(Env.domainMatches("myapp.com:443", { hostname: "myapp.com", port: "" }), true);
  assert.equal(Env.domainMatches("myapp.com:443", { hostname: "myapp.com", port: "443" }), true);
  assert.equal(Env.domainMatches("myapp.com:80", { hostname: "myapp.com", port: "" }), true);
  assert.equal(Env.domainMatches("myapp.com:80", { hostname: "myapp.com", port: "8080" }), false);
  assert.equal(Env.domainMatches("myapp.com:3000", { hostname: "myapp.com", port: "" }), false);
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

test("importIntoEnvironments: a requestly file merges into an existing domain and appends new domains at the end", () => {
  const existing = [
    { id: "e1", domain: "staging.myapp.com", name: "", enabled: true, rules: [Env.normalizeRule(requestlyRule("a")), Env.normalizeRule(requestlyRule("b"))] },
    { id: "e2", domain: "other.com", name: "", enabled: true, rules: [] },
  ];
  const parsed = Env.parseImport(JSON.stringify([requestlyRule("b"), requestlyRule("c")]));
  const merged = Env.importIntoEnvironments(existing, parsed, { domain: "Staging.MyApp.com", filename: "r.json" });
  assert.equal(merged.environments.length, 2);
  assert.deepEqual(merged.environments[0].rules.map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(merged.summary, { added: 1, replaced: 1, skipped: 0, targets: ["staging.myapp.com"] });
  const fresh = Env.importIntoEnvironments(existing, parsed, { domain: "new.com", filename: "r.json" });
  assert.deepEqual(fresh.environments.map((e) => e.domain), ["staging.myapp.com", "other.com", "new.com"]);
});

test("importIntoEnvironments: two file environments with the same domain merge into one", () => {
  const file = { mockingmoo: 1, environments: [
    { domain: "a.com", name: "", enabled: true, rules: [requestlyRule("x")] },
    { domain: "A.com/", name: "", enabled: true, rules: [requestlyRule("x"), requestlyRule("y")] },
  ] };
  const out = Env.importIntoEnvironments([], Env.parseImport(JSON.stringify(file)), { filename: "f.json" });
  assert.equal(out.environments.length, 1);
  assert.deepEqual(out.environments[0].rules.map((r) => r.id), ["x", "y"]);
  assert.deepEqual(out.summary, { added: 2, replaced: 1, skipped: 0, targets: ["a.com", "a.com"] });
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

test("rulesForPage survives corrupt storage: non-array environments and non-object entries", () => {
  const host = { hostname: "localhost", port: "" };
  assert.deepEqual(Env.rulesForPage({ enabled: true, environments: null }, host).rules, []);
  assert.deepEqual(Env.rulesForPage({ enabled: true, environments: "x" }, host).rules, []);
  const config = { enabled: true, environments: [null, 5, "x", { id: "a", domain: "localhost", enabled: true, rules: [{ id: "r" }] }, { id: "b", domain: 7, enabled: true, rules: [{ id: "q" }] }] };
  assert.deepEqual(Env.rulesForPage(config, host).rules.map((r) => r.id), ["r"]);
});

test("the shipped sample file is a Mockingmoo file with one parked environment", () => {
  const text = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "examples", "sample-rules.json"), "utf8");
  const parsed = Env.parseImport(text);
  assert.equal(parsed.kind, "mockingmoo");
  assert.equal(parsed.environments.length, 1);
  assert.equal(parsed.environments[0].domain, "");
  assert.equal(parsed.environments[0].name, "Sample herd");
  assert.equal(parsed.environments[0].rules.length, 4);
});
