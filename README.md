# gauresh.dev — personal site

A static personal site with two modes: a written portfolio, and a penalty
shootout that reveals the same content. No framework, no runtime dependencies,
no backend.

## Run locally

```bash
python3 devserver.py 4713
```

Then open <http://localhost:4713>. The dev server disables caching, because
`python3 -m http.server` sends no `Cache-Control` and browsers then hold on to
ES modules across reloads — which looks exactly like an edit not applying.

## Build

```bash
node scripts/build-site.mjs
```

Writes `dist/`. The build publishes an **allowlist**, not the working
directory: only `index.html`, `css/`, `js/`, referenced `assets/` and the
headers file are copied. Source photographs, notes, tests and local tooling stay
out of the deployed tree by construction rather than by remembering.

## Checks

```bash
node check.mjs
```

66 checks covering ESM parsing, subresource origins, `innerHTML` discipline,
CSP consistency across the three deploy targets, and the content contract.

## Deploying

Vercel and Netlify both read their config from this directory and run the build
above. `SECURITY.md` explains the header set and, importantly, what GitHub
Pages cannot do (it cannot set headers, so it loses clickjacking protection).
