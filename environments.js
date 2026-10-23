// Pure environment logic. Loaded as a classic script in extension pages (global `Env`)
// and via require() in the Node tests. Must not touch chrome, window, document or location.

const newId = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");

// Merge rules into env.rules: same id is replaced in place, others are appended.
const mergeRules = (env, rules) => {
  let added = 0;
  let replaced = 0;
  for (const rule of rules) {
    const index = env.rules.findIndex((r) => r.id === rule.id);
    if (index >= 0) { env.rules[index] = rule; replaced++; } else { env.rules.push(rule); added++; }
  }
  return { added, replaced };
};

// A bare hostname (dot-separated labels) with an optional numeric port.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

// Returns the normalised domain, "" for blank input, or null when the input is not a plain hostname[:port].
const normalizeDomain = (input) => {
  let value = String(input == null ? "" : input)
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  if (value === "") return "";
  if (/[^\x00-\x7f]/.test(value)) {
    // Internationalised names: let the URL parser produce the punycode form.
    const m = /^(.*?)(:\d{1,5})?$/.exec(value);
    try {
      value = new URL(`http://${m[1]}`).hostname + (m[2] || "");
    } catch {
      return null;
    }
  }
  return DOMAIN_RE.test(value) ? value : null;
};

const Env = {
  normalizeDomain,

  isValidDomain: (input) => {
    const domain = normalizeDomain(input);
    return domain !== null && domain !== "";
  },

  // The top-level page's host. Inside a frame, the last ancestor origin is the top page.
  pageHost: (loc) => {
    const ancestors = loc.ancestorOrigins;
    if (ancestors && ancestors.length) {
      try {
        const { hostname, port } = new URL(ancestors[ancestors.length - 1]);
        return { hostname: hostname.toLowerCase(), port };
      } catch {
        // Sandboxed or opaque ancestors report "null"; match nothing.
        return { hostname: "", port: "" };
      }
    }
    return { hostname: loc.hostname.toLowerCase(), port: loc.port };
  },

  domainMatches: (domain, host) => {
    if (!domain || typeof domain !== "string") return false;
    const i = domain.indexOf(":");
    if (i === -1) return domain === host.hostname;
    if (domain.slice(0, i) !== host.hostname) return false;
    const port = domain.slice(i + 1);
    // The browser reports a default port as "", so an explicit :80 or :443 also matches that.
    return host.port === port || ((port === "443" || port === "80") && host.port === "");
  },

  isParked: (env) => env.domain === "",

  matchingEnvironments: (environments, host, opts = {}) =>
    (Array.isArray(environments) ? environments : []).filter(
      (env) =>
        env && typeof env === "object" &&
        !Env.isParked(env) &&
        (opts.includeDisabled || env.enabled !== false) &&
        Env.domainMatches(env.domain, host)
    ),

  rulesForPage: (config, host) => ({
    enabled: config.enabled,
    rules: Env.matchingEnvironments(config.environments, host).flatMap((env) => (Array.isArray(env.rules) ? env.rules : [])),
  }),

  // Throws on an invalid domain: callers validate first, and null is never stored.
  createEnvironment: ({ domain = "", name = "" } = {}) => {
    const normalized = normalizeDomain(domain);
    if (normalized === null) throw new Error(`"${domain}" is not a valid domain`);
    return { id: newId(), domain: normalized, name, enabled: true, rules: [] };
  },

  findByDomain: (environments, domain) => {
    const wanted = normalizeDomain(domain);
    if (!wanted) return undefined;
    return environments.find((env) => !Env.isParked(env) && env.domain === wanted);
  },

  suggestedDomain: (host) => (host.port ? `${host.hostname}:${host.port}` : host.hostname),

  normalizeRule: (item) => {
    if (!item || item.ruleType !== "Response" || !Array.isArray(item.pairs)) return null;
    return {
      id: item.id || newId(),
      name: item.name || "Imported rule",
      description: item.description || "",
      // Imported rules always start paused: a shared file must never run code on every site the moment it is loaded.
      status: "Inactive",
      pairs: item.pairs.map((p) => ({
        id: p.id || newId(),
        source: { key: p.source.key || "Url", operator: p.source.operator || "Contains", value: p.source.value || "" },
        response: {
          type: p.response.type === "static" ? "static" : "code",
          value: p.response.value || "",
          statusCode: p.response.statusCode || "200",
          serveWithoutRequest: p.response.serveWithoutRequest !== false,
        },
      })),
    };
  },

  parseImport: (text) => {
    const parsed = JSON.parse(text);
    const normalizeAll = (items) => {
      const rules = [];
      let skipped = 0;
      for (const item of items) {
        const rule = Env.normalizeRule(item);
        if (rule) rules.push(rule); else skipped++;
      }
      return { rules, skipped };
    };
    if (parsed && !Array.isArray(parsed) && parsed.mockingmoo && Array.isArray(parsed.environments)) {
      let skipped = 0;
      const environments = parsed.environments.map((env) => {
        const result = normalizeAll(Array.isArray(env && env.rules) ? env.rules : []);
        skipped += result.skipped;
        const domain = normalizeDomain(env && env.domain);
        if (domain === null) throw new Error(`"${env.domain}" is not a valid domain`);
        return {
          domain,
          name: (env && env.name) || "",
          enabled: !env || env.enabled !== false,
          rules: result.rules,
        };
      });
      return { kind: "mockingmoo", environments, skipped };
    }
    const { rules, skipped } = normalizeAll(Array.isArray(parsed) ? parsed : [parsed]);
    return { kind: "requestly", rules, skipped };
  },

  importIntoEnvironments: (environments, parsed, opts) => {
    const next = JSON.parse(JSON.stringify(environments));
    const summary = { added: 0, replaced: 0, skipped: parsed.skipped || 0, targets: [] };
    const label = (env) => (Env.isParked(env) ? env.name : env.domain);
    const receive = (env, rules) => {
      const { added, replaced } = mergeRules(env, rules);
      summary.added += added;
      summary.replaced += replaced;
      if (rules.length) summary.targets.push(label(env));
    };
    if (parsed.kind === "requestly") {
      const domain = normalizeDomain(opts.domain);
      if (domain === null) throw new Error(`"${opts.domain}" is not a valid domain`);
      let target;
      if (domain) {
        target = Env.findByDomain(next, domain);
        if (!target) { target = Env.createEnvironment({ domain }); next.push(target); }
      } else {
        target = Env.createEnvironment({ name: opts.filename });
        next.push(target);
      }
      receive(target, parsed.rules);
    } else {
      for (const fileEnv of parsed.environments) {
        let target = fileEnv.domain ? Env.findByDomain(next, fileEnv.domain) : undefined;
        if (!target) {
          target = Env.createEnvironment({ domain: fileEnv.domain, name: fileEnv.domain ? fileEnv.name : fileEnv.name || opts.filename });
          next.push(target);
        }
        receive(target, fileEnv.rules);
      }
    }
    return { environments: next, summary };
  },

  buildExport: (environments) => ({
    mockingmoo: 1,
    environments: environments.map((env) => ({
      domain: env.domain,
      name: env.name,
      enabled: env.enabled,
      rules: env.rules.map((rule) => ({
        ...rule,
        schemaVersion: "3.0.0",
        ruleType: "Response",
        groupId: "",
        isSample: false,
      })),
    })),
  }),

  hostFromUrl: (url) => {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return { hostname: u.hostname.toLowerCase(), port: u.port };
    } catch {
      return null;
    }
  },
};

if (typeof module !== "undefined") module.exports = Env;
