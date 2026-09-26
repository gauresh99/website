# Build contract

Four agents build this in parallel. This file is the interface between them.
**Do not edit files you do not own.** If you need something from another
agent's file, code against the signatures below — they are fixed.

## Stack decision (already made, do not change)

Static site. No framework, no build step, no backend, no database, no cookies,
no analytics, no third-party requests. Plain ES modules, plain CSS, one canvas.

This is a deliberate architectural answer to two of the requirements:

- **Security.** A static site with no server has no server-side attack surface.
  There is no database to leak, no session to steal, no input to inject into.
  The remaining surface is client-side (XSS via injected content, supply chain
  via third-party scripts, clickjacking) and the security agent closes those.
- **Scalability.** Static assets served from a CDN scale to any traffic level
  because every request is a cache hit on an edge node. There is no origin to
  overwhelm. The real performance work is client-side: the game loop must hold
  60fps on a mid-range phone, which is what the DSA agent owns.

Both of those are honest claims. Do not write copy claiming the site is
"unhackable" or "cannot crash" — say what is actually true and why.

## File ownership

| Agent | Owns (writes) | Reads only |
| --- | --- | --- |
| CONTENT | `js/content.js` | everything |
| UI | `css/*.css`, `index.html`, `js/site.js` | everything |
| GAME | `js/game/*.js` | everything |
| SECURITY | `public/_headers`, `netlify.toml`, `vercel.json`, `SECURITY.md`, `js/sanitize.js` | everything |

`js/main.js` and this file are owned by the lead. Do not edit them.

## Data contract — `js/content.js`

Exports exactly one frozen object, `CONTENT`. Every consumer reads this shape.

```js
export const CONTENT = Object.freeze({
  person: {
    name: string,
    tagline: string,          // one line, under 90 chars
    location: string,
    email: string,
    links: [{ label, href, kind: 'linkedin'|'github'|'email' }],
  },

  about: {
    lead: string,             // 1 paragraph, under 60 words
    body: [string],           // 2-3 short paragraphs
  },

  // Ordered oldest -> newest. Rendered as a timeline in normal mode.
  timeline: [{
    id: string,               // stable kebab-case slug
    period: string,           // "Summer 2024"
    title: string,
    org: string,
    kind: 'work'|'research'|'venture'|'project',
    summary: string,          // under 30 words
    detail: [string],         // 1-2 paragraphs
    tech: [string],
  }],

  // Exactly 5. These are the five penalties in the shootout.
  projects: [{
    id: string,               // MUST match the repo name on GitHub
    name: string,
    blurb: string,            // under 20 words, shown on the card face
    body: [string],           // 1-2 paragraphs
    tech: [string],
    repo: string|null,        // full https URL, or null
    // The one detail an interviewer would dig into. Shown on a goal.
    highlight: { label: string, text: string },
    provenance: string|null,  // rewrite/AI-assist note, or null
  }],

  // Shown between rounds in game mode, as "commentary".
  commentary: {
    goal: [string],           // 6+ short lines, under 12 words each
    miss: [string],           // 6+ short lines
    save: [string],           // 6+ short lines
  },
});
```

## Module contract

### `js/site.js` (UI agent)
```js
export function mountSite(root: HTMLElement, content): { destroy(): void }
```
Renders normal mode into `root`. Must be idempotent and fully tear down on
`destroy()` (remove listeners, cancel timers).

### `js/game/index.js` (GAME agent)
```js
export function mountGame(root: HTMLElement, content, opts): {
  destroy(): void,
  reveal(index: number): void,   // jump straight to a section's content
}
// opts: { reducedMotion: boolean, onExit: () => void, onReveal: (id) => void }
```

### `js/sanitize.js` (SECURITY agent)
```js
export function text(value: unknown): string   // safe text node content
export function safeHref(url: unknown): string // '' if not http(s)/mailto
```
Both UI and GAME must route every content string through `text()` before it
reaches the DOM, and every URL through `safeHref()`.

## Hard rules

1. **No `innerHTML` with content data.** Use `textContent` / `createElement`.
   The UI and GAME agents must use `sanitize.js`. Static markup you author
   yourself may use `innerHTML`; anything from `content.js` may not.
2. **No external requests.** No CDN fonts, no analytics, no icon packs. System
   font stack or a self-hosted woff2 in `assets/`. This is a CSP requirement,
   not a preference.
3. **The game never gates content.** Every shot reveals its section whether the
   player scores or misses. Scoring changes the celebration, not the access.
   A "Skip to content" control is always reachable, and mode is toggleable at
   any time from anywhere.
4. **`prefers-reduced-motion` is honoured.** When set, the game renders as a
   static sequence with no animation and no screen shake.
5. **Keyboard and screen reader parity.** Every game action has a keyboard path.
   Content revealed in game mode is announced via a live region.
6. **60fps budget.** No allocation in the animation loop. Pool objects, reuse
   vectors, use a fixed-timestep accumulator with interpolated rendering.
7. **Accuracy over polish in copy.** Every factual claim traces to the brief in
   `CONTENT-BRIEF.md`. Invent nothing.

## Design direction (UI agent leads, others follow)

Vibrant and energetic, but readable first — this is a portfolio a recruiter
reads on a phone, wrapped in a game. Pitch green, floodlight white, and a hot
accent work as a base; commit to a real palette rather than defaults, and make
light and dark both first-class. Cards, chips and pill widgets for structure.
Type: one characterful display face for headings, one highly legible face for
body, both self-hosted or system. Motion should feel like a sports broadcast —
scoreboard wipes, card flips — and must all be disableable.
