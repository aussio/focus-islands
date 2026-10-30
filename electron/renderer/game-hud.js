// Sky island resources on Today: the resource bar over the island, the check-in card (or, after a tap, one
// short note), and the small drawn icons both use. app-source.js places the slots and calls in here.
//
// Three trial looks share one set of markup and differ in styles.css (data-look on each slot):
//   chips  (A) separate chips across the top. Big number, and "+N today" under it. The card is a compact sheet.
//   corner (B) a frosted panel in the top-left corner, with "today" and "on the way" columns to the right of each
//              number. The card is a bubble, and its rewards fly up into the panel when you tap.
//   bare   (C) icons and numbers straight over the sky, totals only. The card is a slim strip.
// The game demo can switch between them; everywhere else uses chips. The looks not picked will be removed.
//
// Numbers are whole and rounded down, so the bar never shows 40 when you have 39.6 and a 40 price would fail.
// With no card open, the big number is what you have. With a card open, it already counts what the card brings,
// because the card's prices are checked against that too, and a small highlighted "+34" shows the part arriving.

const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const whole = value => Math.max(0, Math.floor((Number(value) || 0) + 1e-6));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const looks = [['chips', 'A · Chips'], ['corner', 'B · Corner'], ['bare', 'C · Bare']];
const lookSetting = 'cozy-focus-hud-look';
// Only the demo reads the saved look, so the user's normal app always shows look A.
export function hudLook(status) {
  if (!status?.demo) return 'chips';
  const saved = localStorage.getItem(lookSetting);
  return looks.some(([look]) => look === saved) ? saved : 'chips';
}
export const saveHudLook = look => { if (looks.some(([name]) => name === look)) localStorage.setItem(lookSetting, look); };

// The bar's order, which prices follow too: the four you always see, then planks and Starlight, which show
// once you have some, some is arriving, or some came in today.
const resources = [
  ['wood', 'wood', 'wood', true], ['stone', 'stone', 'stone', true], ['soil', 'soil', 'soil', true],
  ['saplings', 'sapling', 'saplings', true], ['planks', 'plank', 'planks', false], ['starlight', 'Starlight', 'Starlight', false],
].map(([key, one, many, always]) => ({ key, one, many, always }));
const resourceByKey = Object.fromEntries(resources.map(resource => [resource.key, resource]));
const amountWords = (key, amount) => { const { one, many } = resourceByKey[key] || { one: key, many: key }; return `${amount} ${amount === 1 ? one : many}`; };
// [[key, whole amount]] for every amount of at least 1, in bar order, with any unknown resource last.
function amounts(values) {
  const keys = [...resources.map(({ key }) => key), ...Object.keys(values || {}).filter(key => !resourceByKey[key])];
  return keys.map(key => [key, whole(values?.[key])]).filter(([, amount]) => amount > 0);
}
// "40 wood", "1 sapling" ... for the demo panel and for words read aloud.
export const amountList = values => amounts(values).map(([key, amount]) => amountWords(key, amount));
export const listWords = items => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;

// Small icons drawn in the island's own colours (game/scene/style.js), on a 20 by 20 grid.
const iconShapes = {
  // The cut end of a log: bark, pale wood, and two growth rings.
  wood: '<circle cx="10" cy="10.5" r="8.4" fill="#b9825a"/><circle cx="10" cy="10.5" r="6.5" fill="#f6dcb0"/><circle cx="10" cy="10.5" r="4.3" fill="none" stroke="#e2b47a" stroke-width="1.2"/><circle cx="10" cy="10.5" r="1.7" fill="#e2b47a"/><path d="M4.2 6.2a8.4 8.4 0 0 1 4-3.3" fill="none" stroke="#d29a6c" stroke-width="1.2" stroke-linecap="round"/>',
  // A faceted grey-lilac rock, lit from the top left like the island's rocks.
  stone: '<path d="M2.6 14.6 5.2 7.4 10.6 3.4l5.6 3.4 1.6 7.4-5.4 3.4H6.2z" fill="#b8a9dd"/><path d="M10.6 3.4 5.2 7.4l5 1.8z" fill="#d9d0f3"/><path d="m10.2 9.2 6-2.4 1.6 7.4z" fill="#a597d3"/><path d="m10.2 9.2 7.6 5-5.4 3.4z" fill="#8e85c6"/><path d="M2.6 14.6 6.2 17.6h6.2l-2.2-8.4z" fill="#9f92d0"/>',
  // Three light tan planks, stacked.
  planks: '<rect x="2.5" y="12.4" width="15" height="4.2" rx="1.2" fill="#e2b47a"/><rect x="3.5" y="8.2" width="14" height="4.2" rx="1.2" fill="#f0c98f"/><rect x="2" y="4" width="14.5" height="4.2" rx="1.2" fill="#f6d6a4"/><path d="M5 6.1h5M6.5 10.3h6M5.5 14.5h5" stroke="#d9a86c" stroke-width=".9" stroke-linecap="round"/>',
  // A dark mound of soil with a few crumbs.
  soil: '<path d="M1.8 16.4C2.6 10.6 6 7 10 7s7.4 3.6 8.2 9.4z" fill="#8a5a3b"/><path d="M5 10.6C6.3 8.6 8 7.6 10 7.6c1 0 2 .3 2.8.8-2.9.1-5.6 1-7.8 2.2z" fill="#a8714a"/><circle cx="7.4" cy="13" r=".9" fill="#6e452c"/><circle cx="12.6" cy="12" r=".8" fill="#6e452c"/><circle cx="10.6" cy="14.6" r=".8" fill="#6e452c"/><path d="M1.2 16.4h17.6" stroke="#6e452c" stroke-width="1.2" stroke-linecap="round"/>',
  // A green sprout with two leaves.
  saplings: '<path d="M10 17.4V9.6" stroke="#3f9a4c" stroke-width="1.8" stroke-linecap="round"/><path d="M10 10.4C9.6 6.6 6.8 4.6 2.8 4.8c.2 3.8 3 6 7.2 5.6z" fill="#5cc85d"/><path d="M10 9.4c.3-3.6 3-5.8 7.2-6-.1 4-2.9 6.2-7.2 6z" fill="#73d56a"/><path d="M10 10.2C8.8 8 6.8 6.6 4.6 6.2" fill="none" stroke="#3fa64d" stroke-width=".8" stroke-linecap="round"/><ellipse cx="10" cy="17.6" rx="4.4" ry="1.3" fill="#8a5a3b"/>',
  // A soft gold star with rounded points.
  starlight: '<path d="m10 2.6 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.9l5-.7z" fill="#ffd25e" stroke="#f5b52e" stroke-width="1.3" stroke-linejoin="round"/><path d="m10 6.2 1 2.2 2.3.3" fill="none" stroke="#fff3c4" stroke-width="1.1" stroke-linecap="round"/>',
  other: '<circle cx="10" cy="10" r="6" fill="#cfd8cc"/>',
};
export const resourceIcon = key => `<svg class="hud-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${iconShapes[key] || iconShapes.other}</svg>`;
// A small icon-and-number chip: "+34 [wood]" for rewards, "[wood] 40" for prices. Read aloud separately.
const rewardChip = (key, amount) => `<span class="hud-chip" data-resource="${html(key)}"><b>+${html(amount)}</b>${resourceIcon(key)}</span>`;
const priceChip = (key, amount) => `<span class="hud-cost" data-resource="${html(key)}">${resourceIcon(key)}<b>${html(amount)}</b></span>`;

// ---- The resource bar.
// What one look shows for each resource: total, and the small numbers that look uses (0 when not shown).
function barRows(game, look) {
  const card = game.checkIn;
  return resources.map(({ key, always }) => {
    const waiting = whole(game.waiting?.[key]), today = whole(game.today?.[key]);
    const row = {
      key, total: whole((Number(game.onHand?.[key]) || 0) + (card ? Number(game.waiting?.[key]) || 0 : 0)),
      arriving: card ? waiting : 0,
      today: look === 'chips' ? (card ? 0 : today) : look === 'corner' ? today : 0,
      coming: look === 'corner' && !card ? waiting : 0,
    };
    return always || row.total || row.arriving || row.coming || today ? row : null;
  }).filter(Boolean);
}
function rowWords({ key, total, arriving, today, coming }) {
  return [amountWords(key, total), arriving ? `${arriving} of it arriving with this card` : '',
    today ? `${today} came in today` : '', coming ? `${coming} more on the way` : ''].filter(Boolean).join(', ');
}
// before: what the bar showed last time, when this is a change within the same game and look (null otherwise).
// closed: a card was open last time and is gone now.
function barMarkup(rows, look, before, closed) {
  const was = Object.fromEntries((before?.rows || []).map(row => [row.key, row]));
  const fresh = (row, part) => before && was[row.key] && !was[row.key][part] ? ' is-new' : '';
  // Look B names its two small columns once, above them, and only when something is in them.
  const laterName = rows.some(row => row.arriving) ? 'arriving' : rows.some(row => row.coming) ? 'on the way' : '';
  const head = look === 'corner' && (laterName || rows.some(row => row.today))
    ? `<li class="hud-head" aria-hidden="true"><span class="hud-today">${rows.some(row => row.today) ? 'today' : ''}</span><span class="hud-later">${laterName}</span></li>` : '';
  return `<ul class="hud-list">${head}${rows.map(row => {
    const old = was[row.key];
    const changed = before && old && old.total !== row.total;
    const today = row.today ? `<span class="hud-today${fresh(row, 'today')}" aria-hidden="true">+${row.today}${look === 'chips' ? ' <i>today</i>' : ''}</span>` : '';
    const later = row.arriving ? `<span class="hud-later hud-pill${fresh(row, 'arriving')}" aria-hidden="true">+${row.arriving}</span>`
      : row.coming ? `<span class="hud-later hud-coming${fresh(row, 'coming')}" aria-hidden="true">+${row.coming}</span>`
        // Just after a card is collected, its "+34" fades into the number once.
        : closed && old?.arriving ? `<span class="hud-later hud-pill is-settling" aria-hidden="true">+${old.arriving}</span>` : '';
    return `<li class="hud-item" data-resource="${row.key}">${resourceIcon(row.key)}<b class="hud-big${changed ? ' is-changed' : ''}"${changed ? ` data-from="${old.total}"` : ''} aria-hidden="true">${row.total}</b>${today}${later}<span class="hud-words">${html(rowWords(row))}</span></li>`;
  }).join('')}</ul>`;
}

// One bar for the window's life. It redraws only when what it shows changes, not with every status.
export function createHud() {
  const slot = document.createElement('section');
  slot.className = 'today-hud';
  slot.id = 'today-hud';
  slot.setAttribute('aria-label', 'What you have on the island');
  // Today's page is a polite live region; the bar's numbers are read when asked for, never announced.
  slot.setAttribute('aria-live', 'off');
  let shownKey = null, shown = null, tapped = null, tidy = 0;
  function update(status, look) {
    const game = status.game, database = `${status.profile}:${status.publicationEpoch ?? 0}`;
    const card = game?.checkIn?.token || null;
    const rows = game ? barRows(game, look) : [];
    const key = JSON.stringify([look, database, card, rows]);
    if (key === shownKey) return;
    shownKey = key;
    // Changes move only within one game and look: a fresh window, a look switch, or another database just draws.
    const before = shown && shown.look === look && shown.database === database ? shown : null;
    const closed = Boolean(before?.card && !card);
    const flight = closed && tapped?.token === before.card ? tapped.chips : null;
    if (!card || card !== tapped?.token) tapped = null;
    shown = { look, database, card, rows };
    slot.dataset.look = look;
    slot.hidden = !rows.length;
    slot.innerHTML = rows.length ? barMarkup(rows, look, before, closed) : '';
    if (!before) return;
    countUp();
    if (flight && look === 'corner') fly(flight);
    // Take the one-time movement off once it has played, so moving the slot to a new page can't play it again.
    clearTimeout(tidy);
    tidy = setTimeout(() => {
      slot.querySelectorAll('.is-settling').forEach(node => node.remove());
      slot.querySelectorAll('.is-new, .is-changed, .is-bump').forEach(node => node.classList.remove('is-new', 'is-changed', 'is-bump'));
    }, 2200);
  }
  // Numbers that changed count to their new value once. Without motion, or while the window is hidden, they just change.
  function countUp() {
    for (const node of slot.querySelectorAll('.hud-big[data-from]')) {
      const from = Number(node.dataset.from), to = Number(node.textContent);
      node.removeAttribute('data-from');
      if (reducedMotion() || document.hidden || !Number.isFinite(from)) continue;
      const started = performance.now(), length = 650;
      node.textContent = String(from);
      const step = now => {
        const part = Math.min(1, Math.max(0, (now - started) / length));
        node.textContent = String(Math.round(from + (to - from) * (1 - (1 - part) ** 3)));
        if (part < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      // A covered window may stop drawing part-way; make sure the true number is there anyway.
      setTimeout(() => { node.textContent = String(to); }, length + 250);
    }
  }
  // Look B: copies of the card's reward chips float up into the panel's matching rows, then fade.
  function fly(chips) {
    if (reducedMotion() || document.hidden) return;
    chips.forEach(({ key, rect, markup }, index) => {
      const target = slot.querySelector(`.hud-item[data-resource="${key}"] .hud-big`)?.getBoundingClientRect();
      if (!target) return;
      const flyer = document.createElement('span');
      flyer.className = 'hud-chip hud-flyer';
      flyer.setAttribute('aria-hidden', 'true');
      flyer.innerHTML = markup;
      flyer.style.cssText = `left:${rect.left}px;top:${rect.top}px;`;
      document.body.append(flyer);
      const dx = target.left + target.width / 2 - (rect.left + rect.width / 2), dy = target.top + target.height / 2 - (rect.top + rect.height / 2);
      const motion = flyer.animate?.([
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 18}px) scale(.9)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) scale(.45)`, opacity: 0 },
      ], { duration: 720, delay: index * 70, easing: 'cubic-bezier(.45, 0, .35, 1)', fill: 'forwards' });
      let landed = false;
      const land = () => {
        if (landed) return;
        landed = true;
        flyer.remove();
        slot.querySelector(`.hud-item[data-resource="${key}"] .hud-big`)?.classList.add('is-bump');
      };
      if (motion) motion.onfinish = land;
      setTimeout(land, 1400 + index * 70);
    });
  }
  // Called just before a card tap is sent: remembers where its reward chips are, for look B's flight.
  function noteTap(cardNode) {
    tapped = { token: cardNode.dataset.token, chips: [...cardNode.querySelectorAll('.check-in-rewards .hud-chip')]
      .map(chip => ({ key: chip.dataset.resource, rect: chip.getBoundingClientRect(), markup: chip.innerHTML })) };
  }
  return { slot, update, noteTap };
}

// ---- The check-in card.
const sentence = text => { const value = String(text ?? '').trim(); return value.charAt(0).toUpperCase() + value.slice(1); };
export function checkInCard(status) {
  const game = status.game, card = game.checkIn, choice = card.choice;
  const islands = game.islands || [];
  const islandName = id => islands.find(island => island.id === id)?.name || 'The island';
  const brought = amounts(card.collected);
  const notes = [
    // newLand amounts are town grid points (5 rest minutes each), which mean nothing to a person.
    ...(card.newLand || []).filter(grown => Math.round(grown.amount) > 0)
      .map(grown => `${islandName(grown.island)} grew${grown.amount < 10 ? ' a little' : ''}.`),
    ...(card.arrivals || []), ...(card.moments || []), ...(card.surprise ? [card.surprise] : []),
  ].filter(Boolean);
  const pick = (value, label, inner) => `<button class="check-in-option" type="button" data-check-in-pick="${html(value)}" aria-label="${html(label)}">${inner}</button>`;
  let ask = '', options = '';
  if (choice?.kind === 'job') {
    const helper = choice.helperName || 'your helper';
    ask = `Pick a job for ${helper}`;
    options = choice.options.map(option => pick(option.job, `Make ${helper} a ${option.name}: ${option.doing}.`,
      `<strong>${resourceByKey[option.job] ? resourceIcon(option.job) : ''}<span>${html(option.name)}</span></strong><span class="check-in-does" title="${html(sentence(option.doing))}">${html(sentence(option.doing))}</span>`)).join('');
  } else if (choice?.kind === 'build') {
    // With more than one island, say where it goes: once in the question when every option shares an island.
    const places = new Set(choice.options.map(option => option.island));
    const shared = islands.length > 1 && places.size === 1 && choice.options[0]?.island ? islandName(choice.options[0].island) : '';
    ask = shared ? `Pick something to build on ${shared}` : 'Pick something to build';
    options = choice.options.map(option => {
      const price = amounts(option.price);
      const where = islands.length > 1 && option.island ? islandName(option.island) : '';
      const shownWhere = shared ? '' : where;
      const label = `Build ${option.name}${where ? ` on ${where}` : ''}. ${option.does || ''} ${price.length ? `Costs ${listWords(price.map(([key, amount]) => amountWords(key, amount)))}.` : ''}`;
      return pick(option.blueprint, label.replace(/\s+/g, ' ').trim(),
        `<strong><span>${html(option.name)}</span></strong>${option.does ? `<span class="check-in-does" title="${html(option.does)}">${html(option.does)}</span>` : ''}${shownWhere ? `<span class="check-in-where">On ${html(shownWhere)}</span>` : ''}${price.length ? `<span class="check-in-price">${price.map(([key, amount]) => priceChip(key, amount)).join('')}</span>` : ''}`);
    }).join('');
  }
  const heading = status.dayEndedAt ? 'End of the day' : 'Back from your break';
  return `<section class="check-in-card" data-token="${html(card.token)}" aria-labelledby="check-in-title">
    <div class="check-in-head"><h3 id="check-in-title">${heading}</h3>${brought.length ? `<p class="check-in-brought"><span class="hud-words">Your helpers brought ${html(listWords(brought.map(([key, amount]) => amountWords(key, amount))))}.</span><span class="check-in-rewards" aria-hidden="true">${brought.map(([key, amount]) => rewardChip(key, amount)).join('')}</span></p>` : ''}</div>
    ${notes.length ? `<ul class="check-in-notes" title="${html(notes.join(' '))}">${notes.map(note => `<li>${html(note)}</li>`).join(' ')}</ul>` : ''}
    ${options ? `<div class="check-in-ask"><span id="check-in-ask">${html(ask)}</span><button class="check-in-skip" type="button" data-check-in-pick="" id="check-in-skip">Just collect</button></div>
      <div class="check-in-options" role="group" aria-labelledby="check-in-ask">${options}</div>`
    : `<div class="check-in-collect"><p>${html(card.nextUp || '')}</p><button class="button primary" type="button" data-check-in-pick="" id="check-in-collect">Collect</button></div>`}
  </section>`;
}
// After a tap: what the last check-in did, as one gentle line that stays until the next check-in.
export function checkInNote(game) {
  const last = game?.lastCheckIn;
  if (!last) return '';
  const islands = game.islands || [];
  const where = last.built && islands.length > 1 ? islands.find(island => island.id === last.built.island)?.name : '';
  const parts = [...(last.built ? [`Built: ${last.built.name}${where ? ` on ${where}` : ''}.`] : []), ...(last.moments || [])].filter(Boolean);
  if (!parts.length) return '';
  const text = parts.join(' ');
  return `<p class="island-note" title="${html(text)}">${html(text)}</p>`;
}
