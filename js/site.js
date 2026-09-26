/**
 * site.js — normal mode.
 *
 * Renders the readable portfolio: hero, section nav, about, timeline, projects,
 * contact. Owned by the UI agent.
 *
 * Three rules shape everything below.
 *
 * 1. No content string ever reaches the DOM except as a text node, and no
 *    content URL is ever used before safeHref() has approved it. There is no
 *    innerHTML path for data anywhere in this file. Even element ids derived
 *    from content go through slug(), because an id also becomes a fragment
 *    href and an aria-labelledby target.
 *
 * 2. Every listener, observer and timer is registered through on()/track(), so
 *    destroy() is a single sweep and cannot miss one. mountSite() destroys a
 *    previous instance on the same root first, which is what makes it
 *    idempotent — main.js swaps modes by remounting, and a leaked scroll
 *    observer would keep firing against a detached tree.
 *
 * 3. Motion is additive. The pre-reveal state is applied by JS, never by CSS
 *    alone, so a failed script or a missing IntersectionObserver leaves the
 *    page fully visible rather than fully blank. Under prefers-reduced-motion
 *    the reveal machinery is not installed at all.
 */

import { text, safeHref } from './sanitize.js';
import { projectArt, playerFigure } from './game/art.js';

/* One live instance per root. */
const INSTANCES = new WeakMap();

const LINK_KINDS = new Set(['github', 'linkedin', 'email']);
const TIMELINE_KINDS = new Set(['work', 'research', 'venture', 'project']);
const KIND_LABEL = {
  work: 'Work',
  research: 'Research',
  venture: 'Venture',
  project: 'Project',
};

/* --- small DOM helpers ---------------------------------------------------- */

/**
 * Build an element. `text` is assigned with textContent, never parsed.
 * Attribute names and literal strings here are authored in this file; only
 * values that came from content.js are pre-sanitised by the caller.
 */
function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

/** Sanitised string, or '' for anything unusable. */
function t(value) {
  const out = text(value);
  return typeof out === 'string' ? out : '';
}

/** An array of non-empty sanitised strings. */
function list(value) {
  return Array.isArray(value) ? value.map(t).filter(Boolean) : [];
}

/**
 * Content-derived ids become DOM ids and fragment hrefs, so they are held to a
 * stricter alphabet than text(): letters, digits, hyphen, underscore only.
 */
function slug(value, fallback) {
  const cleaned = t(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function num(index) {
  return String(index + 1).padStart(2, '0');
}

function sectionHead(number, eyebrow, title, titleId, note) {
  return el('header', { class: 'section__head' }, [
    el('p', { class: 'eyebrow' }, [
      el('span', { class: 'eyebrow__num', text: number }),
      eyebrow,
    ]),
    el('h2', { class: 'section__title', id: titleId, text: title }),
    el('div', { class: 'section__rule', 'aria-hidden': 'true' }),
    note ? el('p', { class: 'section__note', text: note }) : null,
  ]);
}

function chipRow(items, modifier) {
  const values = list(items);
  if (!values.length) return null;
  return el(
    'ul',
    { class: 'chip-row' },
    values.map((value) => el('li', null, [
      el('span', { class: modifier ? `chip ${modifier}` : 'chip', text: value }),
    ]))
  );
}

/* --- sections ------------------------------------------------------------- */

/**
 * Initials for the portrait fallback. Two characters at most, taken from the
 * first and last word of the name. Purely presentational, so it is fine for
 * this to come back empty — the frame is still a tinted square.
 */
function initials(name) {
  const parts = t(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = [...parts[0]][0] || '';
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] || '' : '';
  return (first + last).toUpperCase();
}

/**
 * The portrait frame.
 *
 * The photo is loaded optimistically: assets/gauresh.jpg may not exist yet.
 * Three things make its absence a non-event rather than a broken image.
 *
 *   1. The frame's size is set by CSS (width + aspect-ratio), not by the
 *      image, so the box is identical before, during and after loading. The
 *      page cannot reflow when the image arrives or fails.
 *   2. The monogram is not a fallback that gets swapped in — it is the resting
 *      state, sitting in the same grid cell underneath. The photo fades in on
 *      top of it. So there is no frame where the reader sees nothing.
 *   3. On error, site.js REMOVES the <img> from the DOM. A broken-image icon
 *      is a rendering of a failed <img> element, so deleting the element is
 *      the only way to be certain no such icon can appear, in any browser.
 *
 * `width`/`height` attributes match the CSS aspect ratio so the intrinsic box
 * is right even in the window before the stylesheet applies.
 */
function buildPortrait(person) {
  const name = t(person.name);
  const mark = initials(name);

  const photo = el('img', {
    class: 'hero__photo',
    src: 'assets/gauresh.jpg',
    alt: name ? `${name}, photographed` : '',
    width: '480',
    height: '480',
    decoding: 'async',
    'data-portrait': 'photo',
  });

  return el('div', { class: 'hero__portrait', 'data-state': 'pending', 'data-portrait': 'frame' }, [
    photo,
    el('span', { class: 'hero__monogram', 'aria-hidden': 'true', text: mark }),
  ]);
}

function buildHero(person) {
  const name = t(person.name);
  const location = t(person.location);
  const role = t(person.role);
  const tagline = t(person.tagline);

  // The player widget lives here rather than in the header: it greets the
  // reader, and a greeting belongs next to the face it is greeting you from,
  // not wedged into the navigation.
  const playerSlot = el('aside', {
    class: 'hero__player',
    id: 'hero-player',
    hidden: true,
    'aria-label': 'Your player number',
  });

  return el('section', { class: 'hero hero--split', 'aria-labelledby': 'hero-title' }, [
    el('div', { class: 'hero__inner' }, [
      buildPortrait(person),
      el('div', { class: 'hero__text' }, [
        el('h1', { class: 'hero__name', id: 'hero-title', text: name }),
        location ? el('p', { class: 'hero__location', text: location }) : null,
        role ? el('p', { class: 'hero__role', text: role }) : null,
        tagline ? el('p', { class: 'hero__tagline', text: tagline }) : null,
        // Links sit under the whole block on one line, per the brief.
        buildLinks(person.links, 'hero__links hero__links--inline', 'link-plain'),
      ]),
      playerSlot,
    ]),
  ]);
}

/**
 * @param {string} className  class for the <ul>
 * @param {string} linkClass  'link-pill' (block of actions) or 'link-plain'
 *                            (a line of text links, used under the portrait)
 */
/**
 * Same-page anchor, or ''.
 *
 * safeHref deliberately permits only http(s) and mailto, and that is the right
 * contract for anything that could leave the page — so rather than widen it, a
 * fragment is validated here against its own narrow pattern. A fragment cannot
 * navigate anywhere or carry a scheme, and restricting it to the id alphabet
 * means it cannot smuggle one either.
 */
function safeFragment(value) {
  const raw = typeof value === 'string' ? value : '';
  return /^#[A-Za-z][A-Za-z0-9_-]*$/.test(raw) ? raw : '';
}

function buildLinks(links, className, linkClass = 'link-pill') {
  const items = (Array.isArray(links) ? links : [])
    .map((link) => {
      const href = safeHref(link && link.href) || safeFragment(link && link.href);
      const label = t(link && link.label);
      if (!href || !label) return null;
      const kind = t(link && link.kind).toLowerCase();
      const glyphClass = LINK_KINDS.has(kind)
        ? `link-glyph link-glyph--${kind}`
        : 'link-glyph';
      const isExternal = /^https?:/i.test(href);
      return el('li', null, [
        el('a', {
          class: linkClass,
          href,
          rel: isExternal ? 'noopener noreferrer' : null,
        }, [
          el('span', { class: glyphClass, 'aria-hidden': 'true' }),
          label,
        ]),
      ]);
    })
    .filter(Boolean);

  if (!items.length) return null;
  return el('ul', { class: className }, items);
}

function buildJumpNav(sections) {
  if (sections.length < 2) return null;
  return el('nav', { class: 'jumpnav', 'aria-label': 'Sections' }, [
    el(
      'ul',
      { class: 'jumpnav__scroll scroll-x' },
      sections.map((section) => el('li', null, [
        el('a', { href: `#${section.id}`, 'data-jump': section.id, text: section.label }),
      ]))
    ),
  ]);
}

function buildAsideInvite(invite) {
  const lead = t(invite && invite.lead);
  const cta = t(invite && invite.cta);
  const href = safeHref(invite && invite.href) || '#shootout';
  if (!lead && !cta) return null;

  return el('div', { class: 'aside-invite' }, [
    lead ? el('p', { class: 'aside-invite__lead', text: lead }) : null,
    cta ? el('a', { class: 'aside-invite__cta', href, 'data-play': 'true' }, [
      el('span', { text: cta }),
      el('span', { class: 'aside-invite__ball', 'aria-hidden': 'true' }),
    ]) : null,
  ]);
}

function buildAbout(about) {
  const greeting = t(about && about.greeting);
  const lead = t(about && about.lead);
  const body = list(about && about.body);
  const aside = (about && about.aside) || {};
  const asideTitle = t(aside.title);
  const asideBody = list(aside.body);
  if (!lead && !body.length) return null;

  return el('section', { class: 'section', id: 'about', 'aria-labelledby': 'about-title' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'about__split' }, [
        // Left: the narrative.
        el('div', { class: 'about__main' }, [
          el('h2', { class: 'about__greeting', id: 'about-title', text: greeting || 'About' }),
          lead ? el('p', { class: 'about__lede', text: lead }) : null,
          el('div', { class: 'prose' }, body.map((para) => el('p', { text: para }))),
        ]),
        // Right: football and everything off the clock.
        asideBody.length
          ? el('aside', { class: 'about__aside', 'aria-labelledby': 'about-aside-title' }, [
              el('h3', { class: 'about__aside-title', id: 'about-aside-title', text: asideTitle }),
              el('div', { class: 'prose prose--tight' }, asideBody.map((para) => el('p', { text: para }))),
              buildAsideInvite(aside.invite),
            ])
          : null,
      ]),
    ]),
  ]);
}

/**
 * One node on the journey tree.
 *
 * A flat <li> with a date, a title, two or three lines, and an optional photo.
 * Entries that correspond to a project link through to the full write-up, so
 * the journey stays skimmable and the detail lives in one place rather than
 * being duplicated into an accordion.
 *
 * Deliberately not a <details>: the previous version hid every line behind a
 * disclosure, which for a twelve-stop journey meant twelve clicks to read it.
 * Everything is open; the tree is the structure.
 */
function buildJourneyNode(entry, index) {
  const id = slug(entry.id, `stop-${index}`);
  const kind = TIMELINE_KINDS.has(t(entry.kind)) ? t(entry.kind) : 'project';
  const date = t(entry.date);
  const title = t(entry.title);
  const org = t(entry.org);
  const summary = t(entry.summary);
  const projectId = slug(entry.projectId, '');

  const heading = el('h3', { class: 'stop__title', id: `${id}-title` }, [
    projectId
      ? el('a', {
          class: 'stop__link',
          href: `#project-${projectId}`,
          'data-project-jump': projectId,
        }, [title, el('span', { class: 'stop__arrow', 'aria-hidden': 'true' })])
      : title,
  ]);

  // An image is decoration here, so it is aria-hidden and carries an empty alt:
  // every fact it conveys is already in the text beside it.
  const photo = entry.image
    ? el('div', { class: 'stop__photo' }, [
        el('img', {
          src: t(entry.image),
          alt: '',
          loading: 'lazy',
          decoding: 'async',
          width: '220',
          height: '220',
          'data-stop-photo': 'true',
        }),
      ])
    : null;

  // Body and photo are wrapped together in one card so the tree can place the
  // pair on either side of the trunk with a single grid-column rule, and the
  // side can alternate in CSS without the markup knowing anything about it.
  return el('li', { class: 'stop', 'data-kind': kind, 'aria-labelledby': `${id}-title` }, [
    el('span', { class: 'stop__node', 'aria-hidden': 'true' }),
    el('div', { class: 'stop__card' }, [
      el('div', { class: 'stop__body' }, [
        date ? el('p', { class: 'stop__date', text: date }) : null,
        heading,
        org ? el('p', { class: 'stop__org', text: org }) : null,
        summary ? el('p', { class: 'stop__summary', text: summary }) : null,
      ]),
      photo,
    ]),
  ]);
}

function buildTimeline(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) return null;

  return el('section', { class: 'section', id: 'journey', 'aria-labelledby': 'journey-title' }, [
    el('div', { class: 'wrap' }, [
      sectionHead('02', 'So far', 'My journey', 'journey-title',
        'Oldest first. Anything with an arrow opens its full write-up.'),
      el('ol', { class: 'tree' }, rows.map(buildJourneyNode)),
    ]),
  ]);
}

/**
 * A project card.
 *
 * The same class contract the game HUD renders into (proj-card__*), so a
 * project revealed by a penalty and a project read on the page are typeset by
 * one set of rules rather than two that drift.
 *
 * Coursework projects have no repo — the code stays private — so the repo link
 * is conditional and the provenance line carries the reason.
 */
function buildProjectCard(project, index) {
  const id = slug(project.id, `project-${index}`);
  const name = t(project.name);
  const body = list(project.body);
  const provenance = t(project.provenance);
  const repo = safeHref(project.repo);

  return el('article', {
    class: 'proj-card',
    id: `project-${id}`,
    'aria-labelledby': `${id}-name`,
    tabindex: '-1',
  }, [
    (() => {
      // Decorative only, so it is aria-hidden inside art.js — every fact it
      // gestures at is already in the words beside it.
      const art = projectArt(project.art);
      return art ? el('div', { class: 'proj-card__art' }, [art]) : null;
    })(),
    el('div', { class: 'proj-card__top' }, [
      el('span', { class: 'proj-card__num', 'aria-hidden': 'true', text: num(index) }),
      el('h3', { class: 'proj-card__name', id: `${id}-name`, text: name }),
    ]),
    // No blurb and no highlight callout: every word on this card is copy the
    // owner wrote for it. Anything summarising on his behalf came out.
    // The long half of the card lives in a <details>. On a phone it starts
    // closed, which is what takes the projects section from sixteen screens of
    // scrolling to about four; from 721px up, site.js forces every one open so
    // a desktop reader never has to click to read.
    //
    // Native <details> rather than a div and a click handler: it gets keyboard
    // operability, the right expanded/collapsed state for assistive tech, and
    // find-in-page expansion for free, and all three are easy to get wrong.
    (() => {
      const points = list(project.points);
      if (!body.length && !points.length) return null;
      return el('details', { class: 'proj-card__more' }, [
        el('summary', { class: 'proj-card__more-toggle' }, [
          el('span', { class: 'proj-card__more-label', text: 'Read more' }),
        ]),
        body.length
          ? el('div', { class: 'proj-card__body' }, body.map((para) => el('p', { text: para })))
          : null,
        points.length
          ? el('ul', { class: 'proj-card__points' }, points.map((line) => el('li', { text: line })))
          : null,
      ]);
    })(),
    chipRow(project.tech, 'chip--tech'),
    el('div', { class: 'proj-card__foot' }, [
      provenance ? el('p', { class: 'proj-card__prov', text: provenance }) : null,
      repo
        ? el('a', {
            class: 'proj-card__repo',
            href: repo,
            rel: 'noopener noreferrer',
            text: 'Repository',
          })
        : null,
    ]),
  ]);
}

function buildProjects(projects) {
  const rows = Array.isArray(projects) ? projects : [];
  if (!rows.length) return null;

  return el('section', { class: 'section', id: 'projects', 'aria-labelledby': 'projects-title' }, [
    el('div', { class: 'wrap' }, [
      sectionHead(
        '03',
        'Selected work',
        'Projects',
        'projects-title',
        'Coursework code (ECE 385, ECE 391) stays private — those are live ' +
        'assignments for students taking the classes now. Happy to walk through ' +
        'any of it.'
      ),
      el(
        'ol',
        { class: 'projects-grid' },
        rows.map((project, index) => el('li', null, [buildProjectCard(project, index)]))
      ),
    ]),
  ]);
}

/**
 * Every address, in full, each one a live mailto.
 *
 * The addresses are shown rather than hidden behind a word: a reader deciding
 * which inbox to use needs to see them, and someone who would rather copy an
 * address than launch a mail client can.
 */
function buildEmailList(person) {
  const rows = Array.isArray(person.emails) ? person.emails : [];
  if (!rows.length) return null;

  const items = rows.map((row) => {
    const address = t(row && row.address);
    const href = safeHref(address ? `mailto:${address}` : null);
    if (!href) return null;
    return el('li', null, [
      el('a', { class: 'contact__email-row', href }, [
        el('span', { class: 'contact__email-kind', text: t(row.label) }),
        el('span', { class: 'contact__email-addr', text: address }),
      ]),
    ]);
  }).filter(Boolean);

  return items.length ? el('ul', { class: 'contact__emails' }, items) : null;
}

function buildContact(person) {
  const email = t(person.email);
  const mailto = safeHref(email ? `mailto:${email}` : null);
  const location = t(person.location);

  return el('section', { class: 'section', id: 'contact', 'aria-labelledby': 'contact-title' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'contact' }, [
        el('p', { class: 'eyebrow' }, [
          el('span', { class: 'eyebrow__num', text: '04' }),
          'Full time',
        ]),
        el('h2', { class: 'contact__title', id: 'contact-title', text: 'Get in touch' }),
        el('p', { class: 'contact__note', text: 'Email is the fastest way to reach me.' }),
        buildEmailList(person) || (mailto ? el('a', { class: 'contact__email', href: mailto, text: email }) : null),
        buildLinks(person.links, 'contact__links'),
        location ? el('p', { class: 'contact__meta', text: location }) : null,
      ]),
    ]),
  ]);
}

/**
 * The invitation back to the shootout, at the foot of the read.
 * Also carries data-play so it shares the hero button's click handling.
 */
function buildPlayCta() {
  return el('aside', { class: 'playcta' }, [
    el('div', { class: 'playcta__text' }, [
      el('p', { class: 'playcta__title', text: 'There is a game version of this page' }),
      el('p', {
        class: 'playcta__note',
        text: 'Five penalties, one for each project. It reveals the same five cards you just '
          + 'read — scoring changes the celebration, not what you get to see.',
      }),
    ]),
    el('a', {
      class: 'btn btn--accent',
      href: '#shootout',
      'data-play': 'true',
      text: 'Take a penalty',
    }),
  ]);
}

/* --- player number -------------------------------------------------------- */
/**
 * PRESENTATION ONLY. The count comes from js/visitors.js:
 *
 *   getPlayerNumber(): Promise<{ number: number|null, label: string, exact: boolean }>
 *
 * The import is DYNAMIC and its failure is swallowed on purpose. A static
 * import would put the player-number helper in the same module graph as the résumé, so a
 * missing or broken visitors.js would blank the whole page — a recruiter
 * losing the content because a player-number helper failed is not a trade worth
 * making. Dynamic, the worst case is a header with no number in it.
 *
 * Three states, two appearances: `pending` and `off` are both "reserved box,
 * nothing drawn", and only `ready` paints. There is deliberately no spinner
 * and no placeholder digit, and a null, non-finite, or non-positive count is
 * treated exactly like a failure — a player number reading 0 is worse than
 * no player number.
 */
const PLAYER_NUMBER_ID = 'hero-player';
let playerNumberStarted = false;

function hidePlayerNumber(slot) {
  slot.hidden = true;
  slot.replaceChildren();
  slot.dataset.state = 'off';
}

/**
 * @returns {boolean} true if a real number was painted.
 */
function renderPlayerNumber(slot, result) {
  if (!result || typeof result !== 'object') return false;
  const raw = result.number;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return false;
  const value = Math.trunc(raw);
  if (value <= 0) return false;

  slot.replaceChildren(
    el('p', { class: 'hero__player-greet' }, [
      el('span', { class: 'hero__player-hello', text: 'Welcome,' }),
      el('span', { class: 'hero__player-name', text: `Player ${value}` }),
    ]),
    el('div', { class: 'hero__player-art' }, [playerFigure(value)])
  );
  slot.hidden = false;
  slot.dataset.state = 'ready';
  return true;
}

/**
 * Runs once per page load, not once per mount: the widget lives in the site
 * header, which is outside #app-root and survives every mode change, so it is
 * page chrome rather than part of the mounted view. That is also why
 * destroy() does not tear it down — there is nothing mounted to tear down,
 * and the header keeps its number when the visitor switches to the game.
 */
export function startPlayerNumber() {
  if (playerNumberStarted) return;
  playerNumberStarted = true;

  const slot = document.getElementById(PLAYER_NUMBER_ID);
  if (!slot) return;

  import('./visitors.js')
    .then((module) => {
      const get = module && module.getPlayerNumber;
      if (typeof get !== 'function') return null;
      return get();
    })
    .then((result) => {
      if (!renderPlayerNumber(slot, result)) hidePlayerNumber(slot);
    })
    .catch(() => {
      // Missing module, rejected promise, thrown getter — all the same answer.
      hidePlayerNumber(slot);
    });
}

/* --- mount ---------------------------------------------------------------- */

/**
 * @param {HTMLElement} root
 * @param {object} content
 * @returns {{ destroy(): void }}
 */
export function mountSite(root, content) {
  if (!root || root.nodeType !== 1) {
    throw new TypeError('mountSite: root must be an element');
  }

  // Idempotent: a second mount on the same root replaces the first cleanly
  // rather than stacking listeners on a tree that is about to be thrown away.
  INSTANCES.get(root)?.destroy();

  const data = content && typeof content === 'object' ? content : {};
  const person = data.person && typeof data.person === 'object' ? data.person : {};

  /** @type {Array<() => void>} */
  const cleanups = [];
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };
  const track = (dispose) => { cleanups.push(dispose); };

  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  const reduced = motionQuery ? motionQuery.matches : false;

  /* --- build --- */

  const about = buildAbout(data.about);
  const timeline = buildTimeline(data.timeline);
  const projects = buildProjects(data.projects);
  const contact = buildContact(person);

  const navSections = [
    about && { id: 'about', label: 'About' },
    timeline && { id: 'journey', label: 'My journey' },
    projects && { id: 'projects', label: 'Projects' },
    { id: 'contact', label: 'Contact' },
  ].filter(Boolean);

  const frag = document.createDocumentFragment();
  frag.append(buildHero(person));
  const nav = buildJumpNav(navSections);
  if (nav) frag.append(nav);
  for (const section of [about, timeline, projects, contact]) {
    if (section) frag.append(section);
  }

  root.dataset.view = 'site';
  root.replaceChildren(frag);

  /* --- behaviour --- */

  // The hero's play control is a real link to #shootout, so it works with no
  // JS at all. This only covers the case where the hash is already #shootout
  // (returned to the site via the toggle), when no hashchange would fire.
  const playLink = root.querySelector('[data-play]');
  if (playLink) {
    on(playLink, 'click', (event) => {
      if (document.documentElement.dataset.mode === 'shootout') return;
      if (window.location.hash === '#shootout') {
        event.preventDefault();
        document.getElementById('mode-toggle')?.click();
      }
    });
  }

  // Journey photos are decorative, so a missing file should leave no trace at
  // all — not a broken-image icon, and not an empty gap where one would be.
  // Removing the whole figure is the only way to be sure of both.
  for (const img of root.querySelectorAll('[data-stop-photo]')) {
    const drop = () => img.closest('.stop__photo')?.remove();
    if (img.complete) {
      if (img.naturalWidth === 0) drop();
    } else {
      on(img, 'error', drop);
    }
  }

  // Project cards: expanded on wide screens, collapsed on phones.
  //
  // Driven from JS rather than CSS because `open` is an attribute, not a style,
  // so no media query can set it. matchMedia keeps it correct when the window
  // is resized or a tablet is rotated, instead of only at first paint.
  const wide = window.matchMedia ? window.matchMedia('(min-width: 721px)') : null;
  if (wide) {
    const syncCards = () => {
      for (const d of root.querySelectorAll('.proj-card__more')) d.open = wide.matches;
    };
    syncCards();
    on(wide, 'change', syncCards);
  }

  // Portrait: swap the monogram out only once the photo has actually decoded.
  //
  // The monogram is the resting state and sits underneath, so there is never a
  // frame showing nothing. On error the <img> is REMOVED rather than hidden:
  // a broken-image icon is the browser rendering a failed <img>, so deleting
  // the element is the only way to guarantee no such icon in any browser.
  const frame = root.querySelector('[data-portrait="frame"]');
  const photo = root.querySelector('[data-portrait="photo"]');
  if (frame && photo) {
    const ready = () => { frame.dataset.state = 'ready'; };
    const failed = () => { frame.dataset.state = 'fallback'; photo.remove(); };
    // A cached image can finish before this runs, so check before listening.
    if (photo.complete) {
      photo.naturalWidth > 0 ? ready() : failed();
    } else {
      on(photo, 'load', ready);
      on(photo, 'error', failed);
    }
  }

  // The journey tree is always open, so there is no expand/collapse to wire.
  // Project links inside it are ordinary fragment links; the browser handles
  // them, and the jump nav below keeps the tab state honest.

  // Scroll reveal. Installed only when it can both run and be wanted; the
  // hidden state is applied here, so it can never strand content.
  if (!reduced && typeof IntersectionObserver === 'function') {
    const targets = Array.from(root.querySelectorAll('.section__head, .tl-item, .projects-grid > li, .contact'));
    for (const target of targets) target.dataset.reveal = '';

    const revealObserver = new IntersectionObserver((records, observer) => {
      for (const record of records) {
        if (!record.isIntersecting) continue;
        record.target.dataset.reveal = 'in';
        observer.unobserve(record.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    for (const target of targets) revealObserver.observe(target);
    track(() => revealObserver.disconnect());

    // If the visitor turns reduced motion on mid-visit, stop animating and
    // show everything that is still pending.
    if (motionQuery?.addEventListener) {
      on(motionQuery, 'change', (event) => {
        if (!event.matches) return;
        revealObserver.disconnect();
        for (const target of targets) target.dataset.reveal = 'in';
      });
    }
  }

  // Scrollspy for the jump nav.
  const jumpLinks = new Map();
  for (const link of root.querySelectorAll('[data-jump]')) {
    jumpLinks.set(link.dataset.jump, link);
  }
  if (jumpLinks.size && typeof IntersectionObserver === 'function') {
    const setCurrent = (id) => {
      for (const [key, link] of jumpLinks) {
        if (key === id) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    };
    const visible = new Set();
    const navObserver = new IntersectionObserver((records) => {
      for (const record of records) {
        if (record.isIntersecting) visible.add(record.target.id);
        else visible.delete(record.target.id);
      }
      const first = navSections.find((section) => visible.has(section.id));
      setCurrent(first ? first.id : null);
    }, { rootMargin: '-25% 0px -60% 0px', threshold: 0 });

    for (const section of navSections) {
      const node = root.querySelector(`#${CSS.escape(section.id)}`);
      if (node) navObserver.observe(node);
    }
    track(() => navObserver.disconnect());
  }

  /* --- teardown --- */

  let destroyed = false;
  const instance = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      while (cleanups.length) {
        const dispose = cleanups.pop();
        try { dispose(); } catch { /* a failed cleanup must not block the rest */ }
      }
      jumpLinks.clear();
      delete root.dataset.view;
      root.replaceChildren();
      if (INSTANCES.get(root) === instance) INSTANCES.delete(root);
    },
  };

  INSTANCES.set(root, instance);
  return instance;
}

export default mountSite;
