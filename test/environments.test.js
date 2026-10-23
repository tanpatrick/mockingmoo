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
