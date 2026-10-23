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

const Env = {
  normalizeDomain: (input) =>
    String(input || "")
      .replace(/\s+/g, "")
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .replace(/[/?#].*$/, "")
      .replace(/:(80|443)$/, ""),

  // The top-level page's host. Inside a frame, the last ancestor origin is the top page.
  pageHost: (loc) => {
    const ancestors = loc.ancestorOrigins;
    if (ancestors && ancestors.length) {
      const { hostname, port } = new URL(ancestors[ancestors.length - 1]);
      return { hostname: hostname.toLowerCase(), port };
    }
    return { hostname: loc.hostname.toLowerCase(), port: loc.port };
  },

  domainMatches: (domain, host) => {
    if (!domain) return false;
    const i = domain.indexOf(":");
    if (i === -1) return domain === host.hostname;
    return domain.slice(0, i) === host.hostname && domain.slice(i + 1) === host.port;
  },

  isParked: (env) => env.domain === "",

  matchingEnvironments: (environments, host, opts = {}) =>
    environments.filter(
      (env) =>
        !Env.isParked(env) &&
        (opts.includeDisabled || env.enabled !== false) &&
        Env.domainMatches(env.domain, host)
    ),

  rulesForPage: (config, host) => ({
    enabled: config.enabled,
    rules: Env.matchingEnvironments(config.environments, host).flatMap((env) => env.rules),
  }),

  createEnvironment: ({ domain = "", name = "" } = {}) => ({
    id: Math.random().toString(16).slice(2, 10).padEnd(8, "0"),
    domain: Env.normalizeDomain(domain),
    name,
    enabled: true,
    rules: [],
  }),

  findByDomain: (environments, domain) => {
    const wanted = Env.normalizeDomain(domain);
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
        return {
          domain: Env.normalizeDomain(env && env.domain),
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
      const domain = Env.normalizeDomain(opts.domain);
      let target;
      if (domain) {
        target = Env.findByDomain(next, domain);
        if (!target) { target = Env.createEnvironment({ domain }); next.unshift(target); }
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
