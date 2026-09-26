/**
 * site-mobile.js — the phone page.
 *
 * Deliberately not the desktop site reflowed. On a phone the desktop tree runs
 * to seventeen screens even with every project collapsed, and that is a shape
 * problem rather than a styling one: CSS can resize a structure, it cannot
 * replace one. So this builds a different, much shorter tree from the same
 * content.
 *
 * WHAT THE PHONE PAGE IS
 *   1. Who I am — photo, name, role, and the three links worth tapping.
 *   2. About, in one column, with the non-engineering half behind a question
 *      so the reader chooses whether to read it.
 *   3. Projects, as cards: title, four-line summary, five skills. Tapping one
 *      opens the full write-up as its own page.
 *
 * WHAT IT DELIBERATELY LEAVES OUT
 * The journey, the contact section, the player number, and the shootout. The
 * game in particular is a pointer-and-keyboard experience built around aiming;
 * shipping it to a phone would mean shipping something worse than not shipping
 * it. The written site carries every fact the game reveals, so nothing is lost
 * by its absence — which was the rule for the game from the start.
 *
 * WHAT IS SHARED
 * js/content.js is the single source of words, so the two pages cannot drift
 * about what they say. Only the structure differs.
 *
 * The rules from site.js still hold: no innerHTML for content, every listener
 * released in destroy().
 */

import { text, safeHref } from './sanitize.js';
import { projectArt } from './game/art.js';

const INSTANCES = new WeakMap();

/* --- helpers (same contract as site.js) ----------------------------------- */

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

const t = (v) => { const out = text(v); return typeof out === 'string' ? out : ''; };
const list = (v) => (Array.isArray(v) ? v.map(t).filter(Boolean) : []);
const slug = (v, fb) => t(v).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fb;
const pad2 = (i) => String(i + 1).padStart(2, '0');

/* --- pieces ---------------------------------------------------------------- */

function buildHero(person) {
  const name = t(person.name);

  const photo = el('img', {
    class: 'm-hero__photo',
    src: 'assets/gauresh.jpg',
    alt: name ? `${name}, photographed` : '',
    width: '160', height: '213',
    decoding: 'async',
    'data-portrait': 'photo',
  });

  // The desktop hero's Email link points at #contact. This page has no contact
  // section, so that link would go nowhere — it is dropped here and the
  // addresses are rendered directly instead, each one a live mailto.
  const links = (Array.isArray(person.links) ? person.links : [])
    .map((link) => {
      const raw = t(link && link.href);
      if (raw.startsWith('#')) return null;
      const href = safeHref(link && link.href);
      const label = t(link && link.label);
      if (!href || !label) return null;
      return el('li', null, [
        el('a', {
          class: 'm-hero__link',
          href,
          rel: href.startsWith('http') ? 'noopener noreferrer' : null,
          text: label,
        }),
      ]);
    })
    .filter(Boolean);

  const emails = (Array.isArray(person.emails) ? person.emails : [])
    .map((row) => {
      const address = t(row && row.address);
      const href = safeHref(address ? `mailto:${address}` : null);
      if (!href) return null;
      return el('li', null, [
        el('a', { class: 'm-mail', href }, [
          el('span', { class: 'm-mail__kind', text: t(row.label) }),
          el('span', { class: 'm-mail__addr', text: address }),
        ]),
      ]);
    })
    .filter(Boolean);

  return el('header', { class: 'm-hero' }, [
    el('div', { class: 'm-hero__row' }, [
      el('div', { class: 'm-hero__frame', 'data-portrait': 'frame', 'data-state': 'pending' }, [photo]),
      el('div', { class: 'm-hero__id' }, [
        el('h1', { class: 'm-hero__name', id: 'hero-title', text: name }),
        el('p', { class: 'm-hero__role', text: t(person.role) }),
        el('p', { class: 'm-hero__loc', text: t(person.location) }),
      ]),
    ]),
    el('p', { class: 'm-hero__tagline', text: t(person.tagline) }),
    links.length ? el('ul', { class: 'm-hero__links' }, links) : null,
    emails.length ? el('ul', { class: 'm-mails' }, emails) : null,
  ]);
}

function buildAbout(about) {
  const aside = (about && about.aside) || {};

  return el('div', { class: 'm-prose' }, [
    el('h2', { class: 'm-h2', text: t(about.greeting) || 'About' }),
    el('p', { class: 'm-lede', text: t(about.lead) }),
    ...list(about.body).map((p) => el('p', { text: p })),

    // The football half sits behind a question rather than beside the text.
    // On a phone a second column is just more scrolling; a dropdown lets the
    // reader decide whether they want it. The shootout invitation is dropped
    // here entirely — the game does not run on phones, so inviting someone
    // into it would be an invitation to nothing.
    list(aside.body).length
      ? el('details', { class: 'm-reveal' }, [
          el('summary', { class: 'm-reveal__q' }, [
            el('span', { text: 'Wanna know about me outside engineering?' }),
          ]),
          el('div', { class: 'm-reveal__body' },
            list(aside.body).map((p) => el('p', { text: p }))),
        ])
      : null,
  ]);
}

/**
 * A project card in the list.
 *
 * Collapsed it shows the title, a four-line summary and the five skills that
 * matter most. Tapping it opens the full write-up as its own page. Four lines
 * is enforced by line-clamp rather than by truncating the string, so the text
 * stays whole for search and for screen readers and only the *display* is cut.
 */
function buildProjectRow(project, index) {
  const art = projectArt(project.art);
  const summary = list(project.body)[0] || '';
  const skills = list(project.tech).slice(0, 5);

  return el('li', null, [
    el('button', {
      class: 'm-card', type: 'button', 'data-project': slug(project.id, `p-${index}`),
    }, [
      el('span', { class: 'm-card__head' }, [
        art ? el('span', { class: 'm-card__art' }, [art]) : null,
        el('span', { class: 'm-card__title', text: t(project.name) }),
        el('span', { class: 'm-card__chev', 'aria-hidden': 'true' }),
      ]),
      summary ? el('span', { class: 'm-card__summary', text: summary }) : null,
      skills.length
        ? el('span', { class: 'm-card__skills' },
            skills.map((v) => el('span', { class: 'm-chip', text: v })))
        : null,
    ]),
  ]);
}

/** Full-screen detail for one project. */
function buildSheet(project, index, onBack) {
  const repo = safeHref(project.repo);
  const back = el('button', { class: 'm-sheet__back', type: 'button' }, [
    el('span', { class: 'm-sheet__back-arrow', 'aria-hidden': 'true' }),
    'Projects',
  ]);
  back.addEventListener('click', onBack);

  return el('div', { class: 'm-sheet', role: 'dialog', 'aria-label': t(project.name) }, [
    el('div', { class: 'm-sheet__bar' }, [back]),
    el('div', { class: 'm-sheet__body' }, [
      el('p', { class: 'm-sheet__num', text: pad2(index) }),
      el('h2', { class: 'm-h2', text: t(project.name) }),
      ...list(project.body).map((p) => el('p', { text: p })),
      list(project.points).length
        ? el('ul', { class: 'm-sheet__points' },
            list(project.points).map((line) => el('li', { text: line })))
        : null,
      list(project.tech).length
        ? el('ul', { class: 'm-chips' },
            list(project.tech).map((v) => el('li', null, [el('span', { class: 'm-chip', text: v })])))
        : null,
      repo
        ? el('a', { class: 'm-cta m-cta--quiet', href: repo, rel: 'noopener noreferrer', text: 'Open the repository' })
        : null,
    ]),
  ]);
}

/* --- mount ---------------------------------------------------------------- */

/**
 * @param {HTMLElement} root
 * @param {object} content
 * @returns {{ destroy(): void }}
 */
export function mountSite(root, content) {
  if (!root || root.nodeType !== 1) throw new TypeError('mountSite: root must be an element');
  INSTANCES.get(root)?.destroy();

  const data = content && typeof content === 'object' ? content : {};
  const person = (data.person && typeof data.person === 'object') ? data.person : {};
  const projects = Array.isArray(data.projects) ? data.projects : [];

  const cleanups = [];
  const on = (node, type, fn, opt) => {
    node.addEventListener(type, fn, opt);
    cleanups.push(() => node.removeEventListener(type, fn, opt));
  };

  const sheetHost = el('div', { class: 'm-sheet-host', hidden: true });
  let lastOpener = null;

  function openProject(id, opener) {
    const index = projects.findIndex((p) => slug(p.id, '') === id);
    if (index < 0) return;
    lastOpener = opener || null;
    sheetHost.replaceChildren(buildSheet(projects[index], index, closeProject));
    sheetHost.hidden = false;
    document.body.dataset.sheet = 'open';
    // Move focus into the sheet. A full-screen view that opens without taking
    // focus leaves a keyboard or screen-reader user on the list behind it.
    sheetHost.querySelector('.m-sheet__back')?.focus();
  }

  function closeProject() {
    sheetHost.hidden = true;
    sheetHost.replaceChildren();
    delete document.body.dataset.sheet;
    // Return focus to the card that opened it, not to the top of the page.
    lastOpener?.focus();
    lastOpener = null;
  }

  const projectList = el('ul', { class: 'm-cards' },
    projects.map((project, i) => buildProjectRow(project, i)));

  const body = el('div', { class: 'm-body' }, [
    el('section', { class: 'm-section' }, [buildAbout(data.about || {})]),
    el('section', { class: 'm-section' }, [
      el('h2', { class: 'm-h2', text: 'Projects' }),
      el('p', { class: 'm-note', text: 'Tap any project to open it. Coursework code (ECE 385, ECE 391) stays private — those are live assignments for students taking the classes now.' }),
      projectList,
    ]),
  ]);

  root.dataset.view = 'mobile';
  root.replaceChildren(buildHero(person), body, sheetHost);

  for (const button of projectList.querySelectorAll('.m-card')) {
    on(button, 'click', () => openProject(button.dataset.project, button));
  }

  // Portrait: remove a failed <img> rather than hide it, so no browser can
  // draw a broken-image icon. Same contract as the desktop renderer.
  const frame = root.querySelector('[data-portrait="frame"]');
  const photo = root.querySelector('[data-portrait="photo"]');
  if (frame && photo) {
    const ready = () => { frame.dataset.state = 'ready'; };
    const failed = () => { frame.dataset.state = 'fallback'; photo.remove(); };
    if (photo.complete) { photo.naturalWidth > 0 ? ready() : failed(); }
    else { on(photo, 'load', ready); on(photo, 'error', failed); }
  }

  on(window, 'keydown', (event) => {
    if (event.key === 'Escape' && !sheetHost.hidden) {
      event.stopPropagation();
      closeProject();
    }
  }, true);

  const instance = {
    destroy() {
      for (const fn of cleanups.splice(0)) {
        try { fn(); } catch { /* listener on a removed node */ }
      }
      delete document.body.dataset.sheet;
      delete root.dataset.view;
      root.replaceChildren();
      INSTANCES.delete(root);
    },
  };
  INSTANCES.set(root, instance);
  return instance;
}
