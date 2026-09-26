# Security posture

What this site is actually protected against, what it is not, and why. Written
to be checkable rather than reassuring — if a claim here cannot be verified from
the repo or a response header, it should not be here.

## The short version

This is a static site. No server, no database, no backend, no cookies, no
sessions, no forms, no third-party code, no network requests after load. That is
not a shortcut, it is the security design: **most of what can be attacked on a
website does not exist here.** There is no query to inject into, no session to
steal, no upload to poison, no dependency to compromise, and no stored user data
to leak — because there is no stored user data.

What remains is a small, real surface: cross-site scripting, clickjacking,
transport downgrade, and whatever the host itself exposes. Those are addressed
below.

**This site is not "unhackable" and nothing here claims it is.** A static page
with no backend is a genuinely hard target, but it still depends on the hosting
platform, the DNS registrar, and the GitHub account that publishes it. Those are
the realistic ways it gets defaced, and none of them are fixed by anything in
this repo. See *What this does not protect against*.

## Threat model

| Threat | Status | How |
| --- | --- | --- |
| SQL / command injection | **Not applicable** | No server, no database, no interpreter handling input |
| Session hijacking, CSRF | **Not applicable** | No sessions, no cookies, no authenticated state, no forms |
| Server RCE, path traversal | **Not applicable** | No application server; the host serves bytes |
| Data breach | **Not applicable** | No user data is collected, transmitted, or stored anywhere |
| Supply-chain compromise | **Eliminated** | Zero runtime dependencies, zero third-party origins |
| Cross-site scripting | **Mitigated, defence in depth** | Four independent layers, below |
| Clickjacking | **Mitigated where headers exist** | `frame-ancestors 'none'` + `X-Frame-Options: DENY` — *not available on GitHub Pages* |
| Transport downgrade | **Mitigated** | HSTS with `includeSubDomains; preload`, `upgrade-insecure-requests` |
| MIME confusion | **Mitigated** | `X-Content-Type-Options: nosniff` |
| Referrer leakage | **Mitigated** | `Referrer-Policy: no-referrer` |
| Denial of service | **Structurally resistant** | Static assets on a CDN; every request is an edge cache hit, no origin to exhaust |
| Host / registrar / account takeover | **Not mitigated here** | Out of scope for the repo — see below |

## XSS: four layers, any one of which would do

All rendered text originates from `js/content.js`, which is authored in-repo and
not user input. The layers exist because "the data is trusted" is exactly the
assumption that ages badly the first time something dynamic gets added.

1. **No `innerHTML`, anywhere.** Every content string reaches the DOM through
   `textContent` or `createElement`. Verified by `check.mjs`, which fails the
   build on any `innerHTML` / `outerHTML` / `insertAdjacentHTML` in JS.
2. **`js/sanitize.js`.** `text()` coerces any value to a safe string and never
   throws; `safeHref()` returns `''` for anything that is not `http(s):` or
   `mailto:`. 26 unit tests in `test/sanitize.test.js`, plus an adversarial
   probe of 32 hostile URLs — control characters inside the scheme
   (`java\tscript:`, NUL, CR/LF), BOM and RTL-override prefixes, backslash and
   protocol-relative forms, percent-encoded schemes, and mail-header injection
   via `%0ABcc:`. Zero leaks, zero throws.
3. **CSP `default-src 'none'`.** No `unsafe-inline`, no `unsafe-eval`. A script
   injected into the markup would not execute, because only same-origin script
   files are permitted and there are no inline handlers.
4. **Trusted Types.** `require-trusted-types-for 'script'` with
   `trusted-types 'none'` makes DOM XSS sinks throw at runtime in supporting
   browsers. This turns rule 1 from a convention into an enforced invariant.

### One invariant worth stating explicitly

`text()` returns the raw string including any `<` and `>`. It is safe **only**
because callers assign it via `textContent`, which does not parse markup. It is
not an HTML escaper, and `element.innerHTML = text(x)` would be an XSS. That
combination is blocked three ways — the CI grep, the CSP, and Trusted Types —
but anyone extending this code should know the function's contract rather than
assume the name means escaping.

## Content-Security-Policy

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none';
frame-src 'none'; worker-src 'none'; manifest-src 'self'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script';
trusted-types 'none'; upgrade-insecure-requests
```

Each non-obvious directive, and why it is there rather than copied from a list:

- `default-src 'none'` — deny by default; every capability below is an explicit
  opt-in. Anything added later fails closed instead of silently inheriting.
- `connect-src 'none'` — the page makes no network requests after load. If code
  ever tries to, it breaks loudly rather than quietly exfiltrating.
- `base-uri 'none'` — blocks `<base>` injection, which can redirect every
  relative URL on the page including the script tags.
- `form-action 'none'` — there are no forms; if markup injection creates one, it
  has nowhere to post.
- `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'` — legacy plugin
  and nested-context vectors, none of which this page uses.
- `img-src 'self' data:` — `data:` is used only for a CSS-authored SVG texture
  in `css/site.css`; no user-provided data reaches a `data:` URL sink.
- `X-XSS-Protection: 0` — deliberately **off**. The legacy auditor is removed
  from modern browsers and its filter was itself exploitable; CSP replaces it.

### Deployment matters more than the policy text

The policy lives in three places that must not drift: `public/_headers`
(Netlify / Cloudflare Pages), `vercel.json`, and a `<meta http-equiv>` fallback
in `index.html`. The CI security job asserts they agree.

**GitHub Pages cannot set HTTP headers.** Given this project is published from
GitHub, that is the likely host, and without the meta fallback it would ship
with no CSP at all. The meta tag covers that — but browsers ignore
`frame-ancestors`, `report-uri` and `sandbox` in meta, and `X-Frame-Options` is
header-only. So:

> **On GitHub Pages this site has its full CSP but no clickjacking protection.**
> If that matters, host it on Cloudflare Pages or Netlify, which serve
> `public/_headers` and give you the complete set for free.

That is a real limitation, stated rather than papered over.

### What is actually published

Production deploys should publish `dist/`, not the working directory. The
dependency-free `scripts/build-site.mjs` build is an allowlist copy: it writes
`index.html`, `css/`, `js/`, the assets those files actually reference, and
`_headers`. It deliberately leaves behind local agent files, tests, markdown
notes, deployment scripts, and raw source images that are not used by the page.

This is not a bundler and it does not introduce a package manager or third-party
build dependency. Its purpose is publish-surface reduction: a file cannot leak
from production if it never enters the publish directory. CI verifies the build
output excludes `.claude`, `.github`, `test/`, `SECURITY.md`, and the large raw
image files that are kept only as local source material.

## What a visitor's browser stores

Two `localStorage` keys, both written by the page and read by nobody else:

| Key | Value | Why |
| --- | --- | --- |
| `gm-mode` | `site` or `shootout` | Opens the site the way the visitor left it |
| `gm-theme` | `light` or `dark` | Persists an explicit theme choice; unset follows the OS |

Nothing else. No cookies, no `sessionStorage`, no IndexedDB, no fingerprinting,
no analytics, no telemetry, no third-party contact of any kind. Every access is
wrapped in `try/catch` because `localStorage` *throws* rather than returning
null under some privacy configurations, and the site works correctly with
storage entirely unavailable.

### On the shirt number

It is a random number assigned to the current page session, not a visitor
counter, and the UI labels it as a player number rather than a count. It is
held in memory only, not in `localStorage`, so it changes on a new page load.
That distinction is load bearing in two directions.

Editorially: every other number on this site traces to something real, and a
fabricated statistic presented as a real one would be the easiest thing on the
page for a reader to catch — and catching it would cast doubt on the rest.

Technically: a real visitor count needs a server to count on, which means an
outbound request per visit, a `connect-src` exception, and some log somewhere
holding visitor IP addresses. `js/visitors.js` makes **no network request at
all**, which is precisely why `connect-src 'none'` and the "no third-party
contact" claim above both survive intact.

If a real count is ever wanted, the honest implementation is a Cloudflare Worker
with a KV counter on your own domain — you own the data, no third party is
involved, and only then may the label say "visitors".

## Availability

The "cannot crash under load" requirement is answered structurally rather than
by tuning. Static assets on a CDN mean every request is an edge cache hit; there
is no origin process, no connection pool, and no database to saturate, so
traffic that would take down an application server is simply cache hits here.
For a local regression check, `scripts/load-smoke.mjs` serves the generated
`dist/` tree from an immutable in-memory map and makes 10,000 HTTP requests
against it. That does not benchmark the production CDN, but it does verify this
repo still produces a finite static artifact with no dynamic request path to
crash.

Client-side, the failure mode that actually bricks a page is a runaway animation
loop. `js/game/loop.js` has three independent guards against the
backgrounded-tab catch-up spiral, and `js/main.js` loads the game **lazily** so
that a broken or missing game module cannot take down the written site — that
path is exercised, not theoretical: with the module absent, the site stays fully
rendered and announces the failure.

## What this does not protect against

Stated plainly, because the rest of this project exists to avoid overclaiming.

- **Account and infrastructure takeover.** Anyone who controls the GitHub
  account, the hosting account, or the DNS registrar can replace this site
  entirely. Nothing in the repo prevents that. Enable 2FA on all three; that is
  the highest-value security action available for a static site and it happens
  outside this codebase.
- **A malicious or compromised host.** Headers and CSP are served by the host.
  A hostile CDN can strip them.
- **Browsers without CSP or Trusted Types support.** Layers 1 and 2 still hold;
  layers 3 and 4 degrade to nothing.
- **Anything added later that introduces a backend.** A contact form, an
  analytics tag, or an embedded widget invalidates most of this document. The
  CI job will fail on a new external origin, which is the intended tripwire.

## Verifying these claims

```bash
node --test test/*.test.js
```

```bash
node scripts/build-site.mjs && node scripts/load-smoke.mjs && node check.mjs && node .github/scripts/security-audit.mjs
```

After deploying, confirm the headers actually arrive — a policy that is not
served is not a policy:

```bash
curl -sI https://<your-domain> | grep -iE 'content-security|strict-transport|x-frame|x-content-type|referrer|permissions'
```
