# Mockingmoo

<img src="icons/logo.svg" alt="Mockingmoo logo: a winking cow with a curly-brace muzzle" width="96" align="right">

A small Chrome extension that intercepts `fetch` and `XMLHttpRequest` calls by URL and replaces or rewrites the response. Use it to develop against APIs that don't exist yet, to reproduce errors and edge cases, or to test a UI against awkward data without touching the backend.

It works with any HTTP API (REST, GraphQL, RPC), and it can import Requestly "Response" rule exports.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension if you want the toolbar icon handy.

After editing any extension file, click the reload icon on its card in `chrome://extensions`, then reload the target page.

## Quick start

1. Click the toolbar icon, then **Manage rules**.
2. Click **Import JSON** and choose `examples/sample-rules.json`.
3. Switch **Static: users list** on. The samples import as `Inactive`.
4. Make sure the popup says **Mockingmoo is on**.
5. Open DevTools on any page and run:

   ```js
   await fetch("/api/users").then((r) => r.json());
   ```

   You get the mocked users, and the console logs:

   ```
   [Mockingmoo] applied "Static: users list" to GET https://your-site/api/users
   ```

Switch the rule off to get real responses again.

## Writing your own rules

Click **New rule**, then **Edit** to expand it. A rule has one or more URL matches. Each match has a URL pattern and a response.

Each response editor has a **Prettier** button that formats the code (or the JSON, for static bodies) in place. Syntax errors are shown under the editor and leave your text unchanged. Prettier 3.3.3 is bundled in `vendor/prettier/`, so it works offline.

### URL patterns

| Option | Matches when |
| --- | --- |
| URL contains | the request URL includes the text, e.g. `/api/users` |
| URL equals | the URL is exactly the text |
| URL matches regex | the URL matches the regex. Use `/pattern/i` for flags |
| URL matches wildcard | `*` stands for any text, e.g. `https://*.example.com/api/*` |

### Response type 1: static body

Returns a fixed body and status code, e.g. to fake an error:

- Pattern: `URL contains` `/api/orders`
- Type: `Static response body`, status `500`
- Body:

  ```json
  { "error": "Internal Server Error" }
  ```

With **Skip network** ticked (fetch only), the real request is never sent.

A static body is returned as plain text. It is never executed, so put code in a "Rewrite with JS" rule.

### Response type 2: rewrite with JS

Define a `modifyResponse` function. It receives the real response and returns the new body, as a string or an object:

```js
function modifyResponse({ responseJSON }) {
  const items = (responseJSON.items || []).slice(0, 2); // keep only the first two
  return { ...responseJSON, items };
}
```

| Argument | Contents |
| --- | --- |
| `url`, `method` | the request URL and HTTP method |
| `requestData` | the request body: parsed if it is JSON, otherwise a string (form-encoded bodies stay a string) |
| `response` | the real response body as a string |
| `responseJSON` | `response` parsed as JSON, or `undefined` if it isn't JSON |
| `statusCode` | the real HTTP status |

Return `undefined` to leave the response unchanged. If the function throws, the error is logged and the real response is used.

### Mocking one call among many

When several calls share one URL, such as GraphQL or a batched RPC endpoint, look at `requestData` and only replace the call you care about:

```js
function modifyResponse({ requestData, response }) {
  if (!requestData || requestData.operationName !== "GetUser") return response;
  return { data: { user: { id: "1", name: "Mocked User" } } };
}
```

Several active rules can match the same URL. They are applied in list order, so each can handle its own operation.

## Import and export

- **Import JSON** accepts Requestly exports (an array of `Response` rules). Rules with an `id` already present are replaced, and other rule types are skipped. `examples/sample-rules.json` is a ready-made set.
- **Export JSON** downloads your rules in the same format, so they can be shared or committed.

## Limitations

- JS rules use `new Function`, so a page whose CSP blocks `unsafe-eval` will log an error. Static rules still work.
- For XHR, the real request is still sent and only the response is replaced. "Skip network" applies to `fetch` only.
- XHR responses of type `arraybuffer` or `blob` are not modified.
- The extension runs on all sites. Switch it off from the popup when you aren't mocking.
- It can't mock requests made before the page's scripts run, such as the initial HTML document.

## Logo and icons

The logo is "Cheeky Moo". `icons/logo.svg` is the full-detail version and `icons/logo-small.svg` is a simplified, thicker-stroke version for small sizes. The braces in both are drawn as paths, so they don't need a font. The extension uses `icon-16/32/48.png` (rendered from the small version) and `icon-128.png` (from the full version). If you change the SVGs, re-render those PNGs at the same sizes.
