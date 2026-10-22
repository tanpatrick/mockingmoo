// Page-world script: patches fetch and XMLHttpRequest and applies matching rules to responses.
(() => {
  if (window.__ftMocker) return;
  window.__ftMocker = true;

  const TAG = "[Mockingmoo]";
  let config = { enabled: true, rules: [] };
  let isReady = false;
  let markReady;
  const ready = new Promise((resolve) => {
    markReady = () => {
      isReady = true;
      resolve();
    };
  });
  // Fail open if the extension bridge never answers.
  setTimeout(markReady, 1500);

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "ft-mocker:config") return;
    config = event.data.config;
    markReady();
  });
  window.postMessage({ source: "ft-mocker:hello" }, "*");

  // ---- matching -----------------------------------------------------------

  const escapeRegExp = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

  function toRegExp(value) {
    const literal = /^\/(.+)\/([a-z]*)$/i.exec(value);
    try {
      return literal ? new RegExp(literal[1], literal[2]) : new RegExp(value);
    } catch (e) {
      return null;
    }
  }

  function sourceTarget(key, url) {
    if (key === "Host" || key === "Path") {
      try {
        const u = new URL(url);
        return key === "Host" ? u.host : u.pathname;
      } catch (e) {
        return url;
      }
    }
    return url;
  }

  function sourceMatches(source, url) {
    const target = sourceTarget(source.key, url);
    const value = source.value == null ? "" : String(source.value);
    // A blank pattern would match every request on every site; treat it as "not set up yet".
    if (!value.trim()) return false;
    switch (source.operator) {
      case "Contains":
        return target.includes(value);
      case "Equals":
        return target === value;
      case "Matches": {
        const re = toRegExp(value);
        return !!re && re.test(target);
      }
      case "Wildcard_Matches":
        return new RegExp("^" + value.split("*").map(escapeRegExp).join(".*") + "$").test(target);
      default:
        return false;
    }
  }

  function findMatches(rawUrl) {
    if (!config.enabled) return [];
    let url = String(rawUrl);
    try {
      url = new URL(url, location.href).href;
    } catch (e) {
      /* keep raw */
    }
    const matches = [];
    for (const rule of config.rules) {
      if (rule.status !== "Active") continue;
      for (const pair of rule.pairs || []) {
        if (!pair.response || !pair.source || !sourceMatches(pair.source, url)) continue;
        if (pair.response.type === "code" && !canEval()) continue;
        matches.push({ pair, rule });
      }
    }
    return matches;
  }

  // ---- applying -----------------------------------------------------------

  // Pages whose Content-Security-Policy forbids 'unsafe-eval' (Outlook, GitHub, many banks…) can't run
  // JS rewrite rules from the page. Probe once, warn once, and leave those requests completely alone.
  let evalAllowed;
  function canEval() {
    if (evalAllowed === undefined) {
      try {
        new Function("");
        evalAllowed = true;
      } catch (e) {
        evalAllowed = false;
        console.warn(TAG, `${location.host} blocks code evaluation (Content Security Policy), so "Rewrite with JS" rules are skipped here. Static response rules still work.`);
      }
    }
    return evalAllowed;
  }

  const compiled = new Map();
  function compile(code) {
    if (!compiled.has(code)) {
      compiled.set(
        code,
        new Function(code + "\n;return typeof modifyResponse === 'function' ? modifyResponse : undefined;")()
      );
    }
    return compiled.get(code);
  }

  const tryParse = (text) => {
    try {
      return JSON.parse(text);
    } catch (e) {
      return undefined;
    }
  };

  function bodyToString(body) {
    if (body == null) return "";
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
      return new URLSearchParams([...body].filter(([, v]) => typeof v === "string")).toString();
    }
    return "";
  }

  // Requestly hands code rules parsed JSON for JSON bodies and a raw string otherwise.
  const requestDataFor = (body) => {
    const parsed = /^\s*[{[]/.test(body) ? tryParse(body) : undefined;
    return parsed === undefined ? body : parsed;
  };

  function apply(matches, ctx) {
    let { status, text } = ctx;
    for (const { pair, rule } of matches) {
      const res = pair.response;
      if (res.type === "static") {
        text = res.value == null ? "" : String(res.value);
        if (res.statusCode) status = Number(res.statusCode);
      } else if (res.type === "code") {
        try {
          const fn = compile(res.value || "");
          if (!fn) throw new Error("no modifyResponse function defined");
          const out = fn({
            method: ctx.method,
            requestData: ctx.requestData,
            response: text,
            responseJSON: tryParse(text),
            statusCode: status,
            url: ctx.url
          });
          if (out !== undefined) text = typeof out === "string" ? out : JSON.stringify(out);
        } catch (e) {
          console.error(TAG, `rule "${rule.name}" failed`, e);
          continue;
        }
      } else {
        continue;
      }
      console.info(TAG, `applied "${rule.name}" to ${ctx.method} ${ctx.url}`);
    }
    return { status, text };
  }

  const skipsNetwork = (matches) =>
    matches.some(({ pair }) => pair.response.type === "static" && pair.response.serveWithoutRequest !== false);

  // ---- fetch ---------------------------------------------------------------

  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    await ready;
    const url = input instanceof Request ? input.url : String(input);
    const matches = findMatches(url);
    if (!matches.length) return nativeFetch.apply(this, arguments);

    const method = String((init && init.method) || (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body = init && init.body != null ? bodyToString(init.body) : "";
    if (!body && input instanceof Request && method !== "GET" && method !== "HEAD") {
      body = await input.clone().text();
    }

    let text = "";
    let status = 200;
    let headers = new Headers({ "content-type": "application/json" });
    if (!skipsNetwork(matches)) {
      const real = await nativeFetch.apply(this, arguments);
      text = await real.text();
      status = real.status;
      headers = new Headers(real.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
    }

    const result = apply(matches, { method, requestData: requestDataFor(body), status, text, url });
    // 101/103/204/205/304 responses must not carry a body, and Response() only accepts 200-599.
    const outStatus = result.status >= 200 && result.status <= 599 ? result.status : 200;
    const nullBody = outStatus === 204 || outStatus === 205 || outStatus === 304;
    const response = new Response(nullBody ? null : result.text, { headers, status: outStatus });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };

  // ---- XMLHttpRequest ------------------------------------------------------
  // The real request is always sent; the response getters are overridden once it completes.

  const XHR = XMLHttpRequest.prototype;
  const nativeOpen = XHR.open;
  const nativeSend = XHR.send;
  const infos = new WeakMap();
  const nativeGet = (xhr, name) => Object.getOwnPropertyDescriptor(XHR, name).get.call(xhr);

  XHR.open = function (method, url) {
    infos.set(this, { method: String(method).toUpperCase(), url: String(url) });
    return nativeOpen.apply(this, arguments);
  };

  function patchXhr(xhr, info, matches, body) {
    const requestData = requestDataFor(bodyToString(body));
    const type = xhr.responseType;
    let result;
    let computed = false;

    const compute = () => {
      if (computed) return result;
      computed = true;
      const status = nativeGet(xhr, "status");
      if (!status) return result;
      let text;
      if (type === "" || type === "text") text = nativeGet(xhr, "responseText");
      else if (type === "json") text = JSON.stringify(nativeGet(xhr, "response"));
      else return result;
      result = apply(matches, { method: info.method, requestData, status, text, url: info.url });
      return result;
    };

    const override = (name, make) =>
      Object.defineProperty(xhr, name, {
        configurable: true,
        get() {
          const r = nativeGet(xhr, "readyState") === 4 ? compute() : undefined;
          return r ? make(r) : nativeGet(xhr, name);
        }
      });

    override("responseText", (r) => r.text);
    override("response", (r) => (type === "json" ? (tryParse(r.text) ?? null) : r.text));
    override("status", (r) => r.status);
  }

  XHR.send = function (body) {
    const info = infos.get(this);
    if (!info) return nativeSend.apply(this, arguments);
    const xhr = this;
    const args = arguments;
    const go = () => {
      const matches = findMatches(info.url);
      if (matches.length) patchXhr(xhr, info, matches, body);
      return nativeSend.apply(xhr, args);
    };
    if (isReady) return go();
    ready.then(go);
  };
})();
