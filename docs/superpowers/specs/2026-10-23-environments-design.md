# Environments: per-domain rule groups

Date: 2026-10-23
Status: approved in conversation; builder-check questions settled (see "Settled after review")

## Intent

Today every rule lives in one flat list and fires on every site. The person
using Mockingmoo wants to mock `/api/hello` one way on their local build,
another way on staging, and never by accident on production. Environments
give each rule a home tied to the domain of the page in the tab, so the
same URL pattern can carry a different response per domain, and a rule set
up while poking at staging cannot leak onto the real site.

## Goals

- Group rules by environment, where an environment is identified by one
  domain, e.g. `localhost:3000`, `staging.myapp.com`, `myapp.com`.
- A rule fires only when the page in the tab belongs to its environment.
- The same URL pattern may exist in several environments with different
  responses. Nothing links such rules; they are independent copies.
- Make the common case fast: create a rule once, copy it to another
  environment, change the body.
- The popup knows which environment the current tab is in and shows only
  that environment's rules.

## Non-goals

- Wildcard or pattern domains (`*.myapp.com`). One environment, one exact
  domain.
- An "everywhere" environment whose rules fire on all sites.
- Per-environment export. Export is all-or-nothing.
- Matching on the host of the request instead of the host of the page.
- Migrating data from the pre-environment storage shape. Nothing has
  shipped, so the old `rules` key is simply no longer read.

## Anti-goals

Things that would make this a failure even if it technically works:

- A rule firing on a domain the user did not name. Isolation is the point.
- Rules from an imported file running anywhere before the user has said
  where they belong and switched them on.
- Asking for a permission that shows an install-time warning. The
  extension asks only for `storage` today; `activeTab` is acceptable
  because Chrome shows no warning for it and it grants access only to the
  tab the user clicked the icon on.

## Constraints

- Manifest V3 Chrome extension, vanilla JavaScript, no build step. Files
  are loaded unpacked straight from the repo.
- Rules are executed in the page's main world by `inject.js`, which
  receives the whole config by `postMessage` from `bridge.js`. The page can
  read whatever is sent to it (documented in the README). Sending only the
  environment that matches the page is therefore both a performance and a
  privacy improvement, and should be done.
- The per-rule JSON shape must stay compatible with Requestly "Response"
  rules so a single rule still round-trips.
- The UI keeps the existing look, copy voice (herd, mooing, napping,
  pasture) and the existing components in `shared.js` (`h`, `toggle`,
  `segmented`, `confirmDialog`, pills animation).

## Decisions made in conversation

These were decided by the person who asked for the feature.

1. Environments are the top level. Every rule belongs to exactly one.
2. The match is on the page open in the tab, not on the request host. A
   rule in the `staging.myapp.com` environment fires for every request that
   page makes, whatever API host it calls.
3. The domain field takes "just a domain", like `hello.com`. No patterns.
4. Rules page layout: stacked, collapsible environment bands on one
   scrolling page (option A of the mockups), not a side rail.
5. Importing a plain Requestly file asks for a domain. If the user skips,
   the rules land in a parked environment that applies to no URL until a
   domain is set.

## Decisions made by the designer

Marked as the designer's calls. Sensible, but open to change.

- **Exact hostname match.** `hello.com` matches only `hello.com`, not
  `www.hello.com`. A domain typed without a port matches that hostname on
  any port; typed with a port it matches only that port. Comparison is
  case-insensitive. Leading `https://`, trailing `/` and surrounding
  whitespace typed into the domain field are stripped on save.
- **Parked environments.** An environment whose domain is blank is parked.
  Its band shows a clear "Parked: not applied anywhere" state. Its rules
  never fire. This is the same guard the blank URL pattern already has.
- **Three switches.** Master (header), environment (band), rule (row). A
  rule fires only when all three are on and the domain matches.
- **Imported rules still arrive paused**, whatever the file says. Parked
  and paused are two independent safeties.
- **"Copy to…"** on each rule offers the other environments. The copy gets
  new ids, the name suffixed " (copy)" only if that name already exists in
  the target, and arrives paused.
- **Popup reads the tab via `activeTab`.** Add `"activeTab"` to
  `permissions` in the manifest. Chrome shows no install warning for it.
  With it, `chrome.tabs.query({ active: true, currentWindow: true })`
  returns the active tab's `url` after the user clicks the icon. If the URL
  is unreadable (chrome:// pages, the Web Store), the popup shows the "no
  environment here" state without a create button. The README's "no
  account, no cloud" claim is unaffected; its permission note is updated.
- **Search on the rules page** stays global across environments. Filter
  pills (All / Active / Paused) also stay global. An environment band
  whose rules are all filtered out still shows, collapsed, so the user can
  see it exists.

## Data model

Stored in `chrome.storage.local`:

```js
{
  enabled: true,
  environments: [
    {
      id: "e1",                 // random, as rules use today
      domain: "localhost:3000", // "" means parked
      name: "",                 // optional label; shown when set, required to tell parked environments apart
      enabled: true,
      rules: [ /* same rule objects as today */ ]
    }
  ]
}
```

**Domains are unique.** Two environments cannot share a non-blank domain.
The inline domain editor rejects a duplicate on blur with a hint ("that
domain already has an environment") and reverts. Any number of parked
environments (blank domain) may exist; their `name` tells them apart, and
the band shows "Untitled" when both are blank.

A rule object keeps its current shape: `id`, `name`, `description`,
`status` (`Active` | `Inactive`), `pairs[]` with `source` and `response`.
Nothing new is added to a rule.

Order of `environments`: environments the user creates (New environment,
the popup's create button, `#new=`) go to the top, matching how new rules
behave today. Imported environments append at the end. Reordering is left
to the builder and may be omitted in the first version. Order of `rules` inside an environment is the application order,
as today.

## Matching

In `bridge.js`, on load and on every storage change:

1. Compute the hostname and port of the **top-level page in the tab**. In
   the top frame that is `location`. In an iframe, use the last entry of
   `location.ancestorOrigins` (supported in Chrome, no permission needed),
   so a third-party widget embedded in `staging.myapp.com` is mocked with
   the staging rules, and a staging iframe embedded in some other site is
   not. This is what "the page where I opened the tab" means.
2. Find the environments whose domain matches (see exact-match rules
   above). There may be more than one only if the user created
   `localhost` and `localhost:3000`; both apply, in environment order.
3. Post to the page `{ enabled, rules }` where `rules` is the concatenated
   rules of the matching, enabled environments. Parked, disabled and
   non-matching environments are never sent to the page.

`inject.js` keeps its current contract: it receives `{ enabled, rules }`
and does not need to know environments exist. This keeps the matcher and
the page-world code unchanged.

## Rules page

Header: brand, master switch, Import, Export, **New environment**.

Each environment is a band with:

- a switch, the domain (editable inline, like a rule name today), a count
  such as "2 rules · 1 active", a **+ Rule** button, and a collapse chevron;
- a parked badge when the domain is blank;
- its rules, rendered with the existing rule card, with one extra tool,
  **Copy to…**, beside Duplicate;
- an empty state inside the band when it has no rules ("No rules here.
  This domain stays real until you say otherwise.");
- Delete environment, behind the existing confirm dialog, which states the
  number of rules that go with it.

**New environment** prompts for the domain inline (a band appears at the
top with the domain field focused). Leaving it blank creates a parked
environment.

Page-level empty state when there are no environments: the existing
"pasture is empty" art with "Create an environment, or import a file."

The `#new` hash from the popup now carries a domain, e.g.
`options.html#new=staging.myapp.com`, and opens with that environment
created (or found) and expanded, with a fresh rule in it.

## Popup

Reads the active tab's hostname and port.

- Tab has a matching environment: a status card carrying the
  **environment switch**, "`staging.myapp.com` · Mooing here · 1 of 2 rules
  active", that environment's rules with their switches, **+ New rule
  here**, and **Open all environments**. With the environment switch off
  the card reads "`staging.myapp.com` · Environment paused · nothing is
  mocked here" and the rule rows are shown dimmed; flipping the card's
  switch wakes it. If several environments match, each gets its own card
  and heading. **+ New rule here** adds to the first matching environment;
  it never creates a second one.
- Tab has no matching environment: a muted card "`github.com` · No
  environment here, so nothing is mocked", **+ Make github.com an
  environment**, **Open all environments**, and a one-line total
  ("3 environments · 4 rules in total"). The created domain is the
  hostname, plus `:port` only when the URL has an explicit non-default
  port (so `localhost:3000` is created as `localhost:3000`, and
  `https://staging.myapp.com` as `staging.myapp.com`).
- Tab URL unreadable: the muted card without the create button.

The master switch stays in the popup header; the matched environment's
switch lives on its status card as described above.

## Import and export

**Export** writes:

```json
{
  "mockingmoo": 1,
  "environments": [
    { "domain": "localhost:3000", "name": "", "enabled": true, "rules": [ /* Requestly-shaped rules */ ] }
  ]
}
```

Each rule inside is exactly what the current export writes (with
`schemaVersion`, `ruleType`, `groupId`, `isSample`), so one environment's
`rules` array is itself a valid Requestly import.

**Import** accepts two shapes:

- A Mockingmoo file (object with `mockingmoo` and `environments`).
  Environments are matched by domain: an existing environment with the same
  domain receives the rules (replacing rules whose `id` already exists,
  appending others); a new domain creates a new environment. Parked
  environments in the file (blank domain) create a new parked environment
  each time, with `name` taken from the file's `name` or, if blank, the
  imported filename. Rules arrive paused.
- A plain Requestly file (array of rules, or a single rule). Before
  reading it, the page asks for a domain with a small dialog (reuse the
  confirm dialog's styling: one text field, **Import here** and **Skip,
  park them**). Enter a domain and the rules go into that environment,
  created if needed. Skip and they go into a new parked environment whose
  `name` is the imported filename. Rules arrive paused. Non-Response rules are skipped and counted, as today.

The status message after import reports what happened, including the
environment name, e.g. "Imported 3 new into staging.myapp.com, all paused."

## Sample file and docs

- `examples/sample-rules.json` becomes a Mockingmoo file with one parked
  environment (blank domain, name "Sample herd") holding the current four
  sample rules, so the quick start imports it, sets a domain, and switches
  a rule on.
- README: quick start gains the "set a domain" step; a new "Environments"
  section explains the domain match, parked state, and the three switches;
  the Limitations entry about rules being readable by pages is softened to
  "the rules for the environment that matches the page".
- Screenshots in `docs/` are retaken after the UI lands.

## Left to the builder

- Internal structure of `options.js` (it is one file today and may stay
  one, or split into environment and rule modules).
- Whether environments can be reordered in the first version.
- Exact copy for the new empty states and dialogs, within the existing
  voice.
- The inline domain editor's behaviour on invalid input (anything that
  is not a bare hostname with optional port): the builder may reject on
  blur with a hint, or normalise, as long as the stored value is a bare
  hostname with optional port.
- Animation details for new bands and the copy-to action, using the
  existing `play` helper and reduced-motion handling.

## Settled after review

A reviewer read this document against the code and asked six questions.
One was already answered in conversation (frames match the tab's top-level
page). The rest were settled by the designer without changing what the
person asked for:

- `activeTab` is added to the manifest. The earlier claim that the popup
  needs no manifest change was wrong; `activeTab` must be declared to read
  the tab URL. It shows no install warning.
- The popup shows the matched environment's switch on its status card, so
  what the popup says is mocked is always true and fixable from there.
- Environments gain an optional `name`, so parked environments can be told
  apart on the band and in Copy to….
- User-created environments go to the top; imported ones append.
- Domains are unique per environment; the editor rejects duplicates.
- "+ New rule here" in the popup adds to the first matching environment;
  the create button uses hostname plus explicit non-default port.
