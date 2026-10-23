// Pure environment logic. Loaded as a classic script in extension pages (global `Env`)
// and via require() in the Node tests. Must not touch chrome, window, document or location.

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
};

if (typeof module !== "undefined") module.exports = Env;
