// Team Office front end: chat, calendar & meetings, board & bugs, CI builds, and the handbook reader.
const $ = (id) => document.getElementById(id);
let S = { repo: '', people: {}, channels: [], messages: {}, typing: new Set(), statuses: {} };
let OFFICE = null, BOARD = null, BUILDS = [], FILES = [];
let view = 'chat', current = 'general', docPath = 'team/README.md', search = '';
const openLogs = new Set();

function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const lastSeen = load('office.seen', {});
const readAt = load('office.readAt', {});
let bellOn = load('office.bell', false);

// ================= icons =================
const ICONS = {
  chat: '<path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  board: '<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="16.5" y="4" width="4" height="13" rx="1.5"/>',
  builds: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4.5-7 3-11.5 5.5"/>',
  book: '<path d="M4 5.5C6.5 4 9.5 4 12 5.5v14C9.5 18 6.5 18 4 19.5z"/><path d="M20 5.5C17.5 4 14.5 4 12 5.5v14c2.5-1.5 5.5-1.5 8 0z"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/>',
  bug: '<rect x="8" y="6" width="8" height="13" rx="4"/><path d="M12 6V4M9 4l1.5 2M15 4l-1.5 2M4 13h4M16 13h4M5 8.5l3 1.5M19 8.5l-3 1.5M5 18l3-1.5M19 18l-3-1.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  bellOff: '<path d="M6 16v-5a6 6 0 0 1 9.5-4.9M18 11v5l2 2H8M10 20.5a2 2 0 0 0 4 0M3 3l18 18"/>',
  play: '<path d="M7 5v14l12-7z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.5 4.5M20 20v-3.5h-3.5"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17"/>',
  doc: '<path d="M7 3.5h7l5 5V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20z"/><path d="M14 3.5v5h5"/>',
  ticket: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5"/>',
  template: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.5h16M9.5 9.5V20"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  flag: '<path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5.5 5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10.5h1.5a2.5 2.5 0 0 1 0 5H17M8 3.5v2M12 3.5v2"/>',
  bolt: '<path d="M13 2.5 4.5 14H12l-1 7.5L19.5 10H12z"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  branch: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="8" r="2"/><path d="M7 7.5v9M17 10c0 4-6 3.5-9.5 6.5"/>',
  sick: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 15.5c2-1.5 5-1.5 7 0M9 10h.5M14.5 10h.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5"/>',
};
const icon = (n, s = 16, w = 1.8) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] ?? ''}</svg>`;

// ================= utils =================
const initials = (n) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return new Date(ms).toLocaleDateString();
}
function toast(text, ms = 3500, ic = 'sparkle') {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `${icon(ic, 15)}<span>${esc(text)}</span>`;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
async function api(path, body) {
  try {
    const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || `Something went wrong (${r.status}).`, 4000, 'alert'); return null; }
    return data;
  } catch { toast('The office server is not reachable. Is `npm run team-chat` still running?', 5000, 'alert'); return null; }
}

// ================= markdown (escapes everything first, so text can never inject HTML) =================
function resolvePath(base, rel) {
  if (rel.startsWith('team/')) return rel;
  const parts = base.split('/').slice(0, -1);
  for (const seg of rel.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
}
const idPath = (id) => ['team/tickets/', 'team/bugs/'].map((d) => d + id + '.md').find((p) => FILES.some((f) => f.path === p));
function link(url, text, base) {
  if (/^https?:\/\//.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
  if (url.startsWith('#')) return `<a href="#" data-anchor="${url.slice(1)}">${text}</a>`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return text;
  let target; try { target = resolvePath(base, decodeURI(url.split('#')[0])); } catch { return text; }
  if (target.startsWith('team/') && target.endsWith('.md')) return `<a href="#doc/${target}">${text}</a>`;
  if (S.repo && target) return `<a href="vscode://file/${encodeURI(S.repo + '/' + target)}" title="Open in VS Code">${text}</a>`;
  return text;
}
function autoIds(html) {
  let inA = 0;
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith('<')) { if (/^<a[\s>]/.test(part)) inA++; else if (part === '</a>') inA--; return part; }
    if (inA) return part;
    return part.replace(/\b(IT-\d{3}|QA-\d+|BUG-\d{3})\b/g, (id) => { const p = idPath(id); return p ? `<a class="ref" href="#doc/${p}">${id}</a>` : id; });
  }).join('');
}
function inline(s, base) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => link(u, t, base))
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
    .replace(/(^|\s)@(Priya|Rafi|Mei|Jonas|Samin|team|everyone)\b/gi, (_, sp, n) => `${sp}<span class="mention ${/samin/i.test(n) ? 'me' : ''}">@${n}</span>`);
  s = autoIds(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}
const slug = (t) => t.toLowerCase().replace(/[`*_[\]()]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plain = (t) => String(t ?? '').replace(/[`*_]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

function md(src, { base = 'team/README.md', breaks = false } = {}) {
  const L = String(src).replace(/\r/g, '').split('\n'), out = [], toc = [];
  const LIST = /^\s*([-*+]|\d+[.)])\s+/;
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isRule = (l) => /^\s*(-{3,}|\*{3,})\s*$/.test(l);
  const starts = (l) => /^```/.test(l) || /^#{1,6}\s/.test(l) || LIST.test(l) || /^>/.test(l) || isRule(l) || isRow(l);
  const lines = (t) => t.split('\n').map((x) => inline(x, base)).join(breaks ? '<br>' : ' ');
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) { const buf = []; i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    if (isRule(l)) { out.push('<hr>'); i++; continue; }
    if (isRow(l) && i + 1 < L.length && /^\s*\|[\s:|-]+\|\s*$/.test(L[i + 1])) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim(), base));
      let h = `<div class="tw"><table><thead><tr>${cells(l).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>`; i += 2;
      while (i < L.length && isRow(L[i])) h += `<tr>${cells(L[i++]).map((c) => `<td>${c}</td>`).join('')}</tr>`;
      out.push(h + '</tbody></table></div>'); continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const n = Math.min(h[1].length, 4), id = slug(h[2]);
      if (n === 2) toc.push({ id, text: plain(h[2]) });
      out.push(`<h${n} id="${id}">${inline(h[2], base)}</h${n}>`); i++; continue;
    }
    if (/^>/.test(l)) { const buf = []; while (i < L.length && /^>/.test(L[i])) buf.push(L[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${md(buf.join('\n'), { base, breaks }).html}</blockquote>`); continue; }
    if (LIST.test(l)) {
      const ordered = /^\s*\d/.test(l), items = [];
      while (i < L.length) {
        const cur = L[i];
        if (LIST.test(cur)) { items.push(cur.replace(LIST, '')); i++; }
        else if (cur.trim() && /^\s/.test(cur) && items.length && !starts(cur.trim())) { items[items.length - 1] += '\n' + cur.trim(); i++; }
        else break;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => {
        const task = t.match(/^\[( |x)\]\s+/i);
        return task ? `<li class="task"><span class="box ${task[1].trim() ? 'on' : ''}">${task[1].trim() ? icon('check', 11, 3) : ''}</span>${lines(t.slice(task[0].length))}</li>` : `<li>${lines(t)}</li>`;
      }).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const buf = [];
    while (i < L.length && L[i].trim() && !(buf.length && starts(L[i]))) buf.push(L[i++].trim());
    out.push(`<p>${lines(buf.join('\n'))}</p>`);
  }
  return { html: out.join(''), toc };
}

// ================= people & presence =================
const STATUS_TEXT = { available: 'Available', busy: 'Busy', meeting: 'In a meeting', out: 'Out of office' };
function presence(id) {
  if ([...S.typing].some((k) => k.endsWith(':' + id))) return 'busy';
  return S.statuses[id] ?? 'available';
}
function avatarHTML(id, cls = '') {
  const p = S.people[id] ?? { name: id, color: '#555' };
  const showDot = !['sm', 'xs'].includes(cls) && S.people[id]?.agent;
  const st = presence(id);
  const face = p.bot ? icon(id === 'ci' ? 'bolt' : 'bell', cls === 'xs' ? 11 : 15) : initials(p.name);
  return `<span class="avatar ${cls}" style="background:${p.color}" title="${esc(p.name)}${showDot ? ' · ' + STATUS_TEXT[st] : ''}">${face}${showDot ? `<span class="dot ${st}"></span>` : ''}</span>`;
}
const chanIcon = (c) => (c.kind === 'dm' ? avatarHTML(c.person) : `<span class="chan-ico">${icon(c.id === 'meetings' ? 'video' : c.id === 'bugs' ? 'bug' : 'hash', 16)}</span>`);

// ================= handbook structure =================
const START = ['team/README.md', 'team/TEAM.md', 'team/WORKFLOW.md', 'team/TEAMMATE-RULES.md'];
const HISTORY = ['team/daylog.md', 'team/decisions.md', 'team/standups.md'];
const words = (p) => p.split('/').pop().replace(/\.md$/, '').replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
function label(f) {
  const t = f.title ? plain(f.title) : words(f.path);
  if (f.path.startsWith('team/templates/')) return words(f.path);
  if (f.path.startsWith('team/people/')) return t.replace(/^Journal:\s*/, '');
  return t;
}
const idNum = (p) => { const m = p.match(/([A-Z]+)-(\d+)\.md$/); return m ? [m[1] === 'IT' ? 0 : 1, +m[2]] : [2, 0]; };
function sections() {
  const by = (pred) => FILES.filter(pred);
  const sortIds = (a, b) => { const x = idNum(a.path), y = idNum(b.path); return x[0] - y[0] || x[1] - y[1] || a.path.localeCompare(b.path); };
  const readmeFirst = (a, b) => (b.path.endsWith('README.md') - a.path.endsWith('README.md')) || sortIds(a, b);
  const pick = (paths) => paths.map((p) => FILES.find((f) => f.path === p)).filter(Boolean);
  const list = [
    { key: 'start', name: 'Start here', items: pick(START), progress: true },
    { key: 'sprint', name: 'Sprint 1', items: [...pick(['team/board.md']), ...by((f) => f.path.startsWith('team/tickets/')).sort(sortIds)] },
    { key: 'bugs', name: 'Bugs', items: by((f) => f.path.startsWith('team/bugs/')).sort(readmeFirst), emptyText: 'No bugs filed yet.' },
    { key: 'qa', name: 'Your QA space', items: by((f) => f.path.startsWith('team/qa/')).sort(readmeFirst) },
    { key: 'templates', name: 'Templates', items: by((f) => f.path.startsWith('team/templates/')).sort((a, b) => a.path.localeCompare(b.path)) },
    { key: 'history', name: 'Team history', items: pick(HISTORY) },
    { key: 'people', name: 'Journals', items: by((f) => f.path.startsWith('team/people/')).sort((a, b) => a.path.localeCompare(b.path)) },
  ];
  const used = new Set(list.flatMap((s) => s.items.map((f) => f.path)));
  const other = FILES.filter((f) => !used.has(f.path));
  if (other.length) list.push({ key: 'other', name: 'Other', items: other });
  return list;
}
const status = (f) => (!(f.path in readAt) ? 'new' : f.modified > readAt[f.path] + 1000 ? 'updated' : 'read');
function markRead(path, modified) { readAt[path] = modified; save('office.readAt', readAt); }
const docsBadge = () => sections().filter((s) => ['start', 'sprint', 'bugs'].includes(s.key)).flatMap((s) => s.items)
  .filter((f) => f.path !== 'team/bugs/README.md' && status(f) !== 'read').length;
const docIcon = (p) => p.endsWith('board.md') ? 'board' : p.includes('/tickets/') ? 'ticket' : p.includes('/bugs/') && !p.endsWith('README.md') ? 'bug'
  : p.includes('/templates/') ? 'template' : p.includes('/people/') ? 'pen' : p.endsWith('daylog.md') ? 'clock' : p.endsWith('decisions.md') ? 'flag' : p.endsWith('standups.md') ? 'users' : 'doc';

// ================= frame: theme, clock, banner, rail, side =================
function renderTheme() {
  const dark = document.documentElement.dataset.theme !== 'light';
  $('theme').innerHTML = icon(dark ? 'sun' : 'moon', 17);
  $('theme').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
}
$('theme').onclick = () => { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = t; save('office.theme', t); renderTheme(); };

function renderClock() {
  if (!OFFICE) return;
  const o = OFFICE;
  const pct = Math.round(((o.day - (o.phase === 'before' ? 1 : 0.5)) / o.daysInSprint) * 100);
  const btn = o.phase === 'before' ? `<button class="btn primary" id="day-btn">${icon('play', 13, 2.2)} Start day ${o.day}</button>`
    : o.phase === 'working' ? `<button class="btn" id="day-btn">${icon('moon', 14)} End day ${o.day}</button>`
    : o.phase === 'ending' ? `<button class="btn" disabled>${icon('refresh', 14)} Wrapping up…</button>`
    : `<button class="btn" disabled>${icon('flag', 14)} Sprint over</button>`;
  $('clock').innerHTML = `<div class="sprint" title="Sprint ${o.sprint}, day ${o.day} of ${o.daysInSprint}"><div class="l1"><span><b>Day ${o.day}</b> / ${o.daysInSprint}</span><span>${o.date}</span></div><div class="bar"><span style="width:${Math.max(3, pct)}%"></span></div></div>${btn}`;
  const b = $('day-btn');
  if (b) b.onclick = o.phase === 'before' ? startDay : confirmEndDay;
  if (o.phase === 'ending') $('clock').querySelector('.btn .i')?.classList.add('spin');
}
function renderBanner() {
  const b = $('banner'), o = OFFICE;
  if (!o) return;
  if (o.meeting) {
    b.hidden = false; b.className = 'banner meet';
    const state = o.meeting.phase === 'wrapping' ? 'wrapping up' : o.meeting.phase === 'opening' ? 'starting' : 'in progress';
    b.innerHTML = `<span class="live-dot"></span><span class="grow"><b>${esc(o.meeting.title)}</b> · ${state}</span>
      ${view === 'chat' && current === 'meetings' ? '' : `<button class="btn sm primary" data-go="#chat/meetings">${icon('video', 13)} Join</button>`}
      ${o.meeting.phase === 'open' ? `<button class="btn sm" id="end-meeting">End meeting</button>` : ''}`;
    const e = $('end-meeting'); if (e) e.onclick = endMeeting;
  } else if (o.phase === 'ending') {
    b.hidden = false; b.className = 'banner info';
    b.innerHTML = `<span class="ico">${icon('moon', 15)}</span><span class="grow"><b>End of day ${o.day}.</b> Your teammates are finishing their day's work. Their updates appear in chat as they're done, which can take a few minutes.</span>`;
  } else if (o.phase === 'before') {
    b.hidden = false; b.className = 'banner info';
    b.innerHTML = `<span class="ico">${icon('coffee', 15)}</span><span class="grow"><b>Day ${o.day} hasn't started.</b> Grab a coffee, then press <b>Start day ${o.day}</b> in the top right when you're ready to work.</span>`;
  } else b.hidden = true;
}
function unread(ch) { return (S.messages[ch] || []).filter((m) => m.from !== 'samin' && m.ts > (lastSeen[ch] || '')).length; }
const RAIL = [['chat', 'Chat', 'chat', '#chat'], ['calendar', 'Calendar', 'calendar', '#calendar'], ['board', 'Board', 'board', '#board'], ['builds', 'Builds', 'builds', '#builds'], ['docs', 'Handbook', 'book', '#doc']];
function renderRail() {
  const counts = {
    chat: S.channels.reduce((n, c) => n + (view === 'chat' && c.id === current ? 0 : unread(c.id)), 0),
    calendar: OFFICE && OFFICE.phase === 'working' ? OFFICE.today.filter((m) => !m.done).length : 0,
    builds: BUILDS.filter((b) => b.status === 'failed').length,
    docs: FILES.length ? docsBadge() : 0,
  };
  $('rail').innerHTML = RAIL.map(([k, l, ic, go]) => `<button class="${view === k ? 'on' : ''}" data-go="${go}" title="${l}"><span class="ri">${icon(ic, 20)}</span>${l}${counts[k] ? `<span class="count ${k === 'builds' ? 'bad' : ''}">${counts[k] > 99 ? '99+' : counts[k]}</span>` : ''}</button>`).join('');
  $('app').classList.toggle('wide', ['calendar', 'board', 'builds'].includes(view));
}
const mobileTabs = () => `<div class="mobile-tabs">${RAIL.map(([k, l, , go]) => `<button data-go="${go}" class="${view === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;

function renderSide() {
  if (view === 'docs') return renderDocNav();
  const row = (c) => {
    const msgs = S.messages[c.id] || [], last = msgs[msgs.length - 1], n = c.id === current && view === 'chat' ? 0 : unread(c.id);
    const who = last ? (last.from === 'samin' ? 'You: ' : c.kind === 'channel' && S.people[last.from] && !S.people[last.from].bot ? S.people[last.from].short + ': ' : '') : '';
    const prev = last ? who + last.text.replace(/[`*_#>|]/g, '').replace(/^\W+\s/, '').slice(0, 80) : c.kind === 'dm' ? STATUS_TEXT[presence(c.person)] : c.topic;
    return `<a class="item ${c.id === current && view === 'chat' ? 'on' : ''} ${n ? 'unread' : ''}" href="#chat/${c.id}">${chanIcon(c)}<span class="meta"><span class="name"><span>${esc(c.name)}</span>${n ? `<span class="badge">${n}</span>` : last ? `<span class="time">${timeOf(last.ts)}</span>` : ''}</span><div class="preview">${esc(prev)}</div></span></a>`;
  };
  $('side').innerHTML = `${mobileTabs()}<h3>Channels</h3>${S.channels.filter((c) => c.kind === 'channel').map(row).join('')}<h3>Direct messages</h3>${S.channels.filter((c) => c.kind === 'dm').map(row).join('')}`;
}
function renderDocNav() {
  const q = search.toLowerCase();
  let html = mobileTabs();
  for (const s of sections()) {
    const items = s.items.filter((f) => !q || label(f).toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    if (q && !items.length) continue;
    const read = s.items.filter((f) => status(f) === 'read').length;
    html += `<h3>${s.name}${s.progress ? `<small>${read}/${s.items.length} read</small>` : ''}</h3>`;
    html += items.map((f) => {
      const st = status(f);
      const mark = st === 'new' ? '<span class="dot-new" title="Not opened yet"></span>' : st === 'updated' ? '<span class="pill">Updated</span>' : s.progress ? `<span class="done" title="Read">${icon('check', 14, 2.2)}</span>` : '';
      return `<a class="item doc-item ${f.path === docPath ? 'on' : ''}" href="#doc/${f.path}" title="${esc(f.path)}">${icon(docIcon(f.path), 15)}<span class="label">${esc(label(f))}</span>${mark}</a>`;
    }).join('');
    if (s.key === 'bugs' && !q && !s.items.some((f) => !f.path.endsWith('README.md'))) html += `<div class="empty-nav">${s.emptyText}</div>`;
  }
  $('side').innerHTML = html;
}

// ================= chat =================
function renderHead() {
  const head = $('head');
  if (view !== 'chat') { head.style.display = 'none'; return; }
  head.style.display = '';
  const c = S.channels.find((x) => x.id === current);
  const sub = c.kind === 'dm' ? `${esc(c.topic)} · ${STATUS_TEXT[presence(c.person)]}` : esc(c.topic);
  const m = OFFICE?.meeting;
  const action = c.id === 'meetings' && m && m.phase === 'open' ? `<button class="btn" id="head-end">End meeting</button>`
    : c.id === 'meetings' && !m ? `<a class="btn" href="#calendar">${icon('calendar', 14)} Calendar</a>`
    : c.id === 'bugs' ? `<button class="btn" id="head-bug">${icon('plus', 14, 2.2)} File a bug</button>` : '';
  head.innerHTML = `<div class="title">${chanIcon(c)}<div style="min-width:0"><b>${esc(c.name)}</b><div class="topic">${sub}</div></div></div>${action}`;
  const e = $('head-end'); if (e) e.onclick = endMeeting;
  const hb = $('head-bug'); if (hb) hb.onclick = () => bugForm('');
}
// System and CI notices are shown as compact event rows, coloured by what they say.
const LEADING = /^\s*(\p{Extended_Pictographic}|\p{Emoji_Presentation})(️)?\s*/u;
function eventKind(m) {
  const e = (m.text.match(LEADING) ?? [])[1] ?? '';
  if (/🎤/.test(e)) return ['turn', 'mic'];
  if (/✅|✔/.test(e)) return ['ok', 'check'];
  if (/❌/.test(e)) return ['bad', 'x'];
  if (/⚠/.test(e)) return ['warn', 'alert'];
  if (/📅/.test(e)) return ['meet', 'video'];
  if (/☀/.test(e)) return ['accent', 'sun'];
  if (/🌙/.test(e)) return ['', 'moon'];
  if (/📒/.test(e)) return ['big', 'list'];
  if (/🏁/.test(e)) return ['accent', 'flag'];
  if (/📋/.test(e)) return ['accent', 'board'];
  if (/🐞/.test(e)) return ['warn', 'bug'];
  if (/🧪/.test(e)) return ['accent', 'search'];
  if (/🔁/.test(e)) return ['bad', 'refresh'];
  if (/out of office/i.test(m.text)) return ['', 'sick'];
  return ['', m.from === 'ci' ? 'bolt' : 'bell'];
}
function eventRow(m) {
  const [kind, ic] = eventKind(m);
  const text = m.text.replace(LEADING, '');
  const cls = kind === 'big' ? 'big' : kind === 'turn' ? 'turn accent' : kind;
  return `<div class="event ${cls}"><div class="eico"><span>${icon(ic, 14)}</span></div><div class="ebody md">${md(text, { breaks: true }).html}<span class="src">${m.from === 'ci' ? 'CI' : ''} ${timeOf(m.ts)}</span></div></div>`;
}
function renderFeed() {
  const feed = $('feed');
  if (view !== 'chat') return;
  feed.className = 'feed';
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
  const c = S.channels.find((x) => x.id === current);
  let msgs = S.messages[current] || [];
  if (search) msgs = msgs.filter((m) => m.text.toLowerCase().includes(search.toLowerCase()));
  if (!msgs.length) {
    const [ic, title, body] = search ? ['search', 'No matches', `Nothing in this conversation matches "${esc(search)}".`]
      : c.kind === 'dm' ? ['chat', `Say hi to ${esc(S.people[c.person].short)}`, `${esc(c.topic)}. Only ${esc(S.people[c.person].short)} sees this conversation.`]
      : c.id === 'meetings' ? ['video', 'No meetings yet', 'Start one from the <a href="#calendar">Calendar</a>. Everyone joins here.']
      : ['hash', `Welcome to #${esc(c.name)}`, `${esc(c.topic)} Priya answers posts that don't @mention anyone.`];
    feed.innerHTML = `<div class="empty"><div class="eic">${icon(ic, 22)}</div><b>${title}</b>${body}</div>`;
  } else {
    let html = '', prev = null;
    for (const m of msgs) {
      if (!prev || dayOf(prev.ts) !== dayOf(m.ts)) { html += `<div class="day">${dayOf(m.ts)}</div>`; prev = null; }
      const p = S.people[m.from] ?? { name: m.from, role: '' };
      if (p.bot || m.from === 'system') { html += eventRow(m); prev = null; continue; }
      const cont = prev && prev.from === m.from && new Date(m.ts) - new Date(prev.ts) < 5 * 60e3;
      const changes = m.changes ? `<details class="changes"><summary>${icon('doc', 13)} Files changed</summary><div class="md">${md(m.changes, { breaks: true }).html}</div></details>` : '';
      html += `<div class="msg ${m.from === 'samin' ? 'mine' : ''} ${cont ? 'cont' : ''}">${m.from === 'samin' ? `<span class="avatar" style="background:#0f8f7e">SZ</span>` : avatarHTML(m.from)}<div class="content"><div class="who"><b>${m.from === 'samin' ? 'You' : esc(p.name)}</b>${m.from === 'samin' ? '' : `<span class="role">${esc(p.role)}</span>`}<time>${timeOf(m.ts)}</time></div><div class="md">${md(m.text, { breaks: true }).html}</div>${changes}</div></div>`;
      prev = m;
    }
    feed.innerHTML = html;
  }
  if (atBottom || renderFeed.jump) { feed.scrollTop = feed.scrollHeight; renderFeed.jump = false; }
  lastSeen[current] = new Date().toISOString(); save('office.seen', lastSeen);
}
function renderTyping() {
  if (view !== 'chat') { $('typing').innerHTML = ''; return; }
  const who = [...S.typing].filter((k) => k.startsWith(current + ':')).map((k) => S.people[k.split(':')[1]]?.short).filter(Boolean);
  $('typing').innerHTML = who.length ? `<span class="dots"><span></span><span></span><span></span></span> ${esc(who.join(', '))} ${who.length > 1 ? 'are' : 'is'} typing…` : '';
}
function renderCompose() {
  const chat = view === 'chat';
  $('compose').style.display = $('typing').style.display = chat ? '' : 'none';
  $('search').placeholder = chat ? 'Search this conversation' : view === 'docs' ? 'Filter the handbook' : 'Search';
  $('search').disabled = !(chat || view === 'docs');
  if (!chat) return;
  const c = S.channels.find((x) => x.id === current);
  const m = OFFICE?.meeting;
  const what = c.kind === 'dm' ? `Only ${esc(S.people[c.person].short)} sees this` : c.id === 'meetings' && m ? `Everyone in the ${esc(m.title)} hears you` : '<kbd>@</kbd> mention someone, or @team for everyone';
  $('hint').innerHTML = `<span>${what}</span><span><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span>`;
  $('input').placeholder = c.kind === 'dm' ? `Message ${S.people[c.person].short}` : c.id === 'meetings' && m ? 'Speak in the meeting…' : `Message #${c.name}`;
}

// ================= calendar =================
const MEET_ICON = { standup: 'users', planning: 'flag', refinement: 'search', triage: 'bug', oneonone: 'coffee', demo: 'play', retro: 'refresh' };
function renderCalendar() {
  const feed = $('feed'); feed.className = 'page';
  const o = OFFICE;
  if (!o) { feed.innerHTML = ''; return; }
  const canMeet = o.phase === 'working' && !o.meeting;
  const tickets = (BOARD?.tickets ?? []).filter((t) => t.type === 'Story' && t.status !== 'Done');
  const ticketSelect = (id) => `<select id="${id}">${tickets.map((t) => `<option value="${t.id}">${t.id} · ${esc(plain(t.title)).slice(0, 46)}</option>`).join('')}</select>`;
  const slot = (m, i) => {
    const live = o.meeting && o.meeting.type === m.type;
    const state = m.done ? `<span class="tag ok">${icon('check', 12, 2.4)} Done</span>` : live ? '<span class="tag meet"><span class="pip"></span>Live</span>' : '';
    const pickT = m.type === 'refinement' && !m.done && !live ? ticketSelect('slot-ticket-' + i) : '';
    const btn = m.done ? '' : live ? `<a class="btn primary" href="#chat/meetings">${icon('video', 14)} Join</a>` : `<button class="btn primary" data-meet="${m.type}" data-ticket-from="${pickT ? 'slot-ticket-' + i : ''}" ${canMeet ? '' : 'disabled'}>${icon('play', 12, 2.2)} Start</button>`;
    return `<div class="card slot ${m.done ? 'done' : ''} ${live ? 'live' : ''}"><span class="t">${m.time}</span>
      <div class="lead"><span class="kind">${icon(MEET_ICON[m.type] ?? 'calendar', 18)}</span><div class="what"><b>${esc(m.title)}</b>${m.note ? `<small>${esc(m.note)}</small>` : ''}</div></div>
      <div class="row-actions">${state}${pickT}${btn}</div></div>`;
  };
  const why = o.phase === 'before' ? `Day ${o.day} hasn't started. Press <b>Start day ${o.day}</b> at the top to begin.`
    : o.phase === 'ending' ? 'The day is ending, so no new meetings.' : o.phase === 'done' ? 'The sprint is over. You can still hold the review and the retro if you missed them.' : '';
  const types = Object.entries(o.titles);
  feed.innerHTML = `
    <div class="page-head"><div><h1>Today</h1><p>Day ${o.day} of ${o.daysInSprint} · ${o.date} · Sprint ${o.sprint}${o.out.length ? ` · Out of office: ${o.out.map((p) => esc(S.people[p].short)).join(', ')}` : ''}</p></div></div>
    ${why ? `<div class="notice">${icon('coffee', 17)}<span>${why}</span></div>` : ''}
    <div class="timeline">${o.today.map(slot).join('') || '<div class="card muted">No meetings today.</div>'}</div>
    <div class="section-title">${icon('plus', 13, 2.2)} Start a meeting now</div>
    <div class="card adhoc">
      <select id="adhoc-type">${types.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <span id="adhoc-ticket-wrap" hidden>${ticketSelect('adhoc-ticket')}</span>
      <button class="btn primary" id="adhoc-start" ${canMeet || o.phase === 'done' ? '' : 'disabled'}>${icon('play', 12, 2.2)} Start</button>
      <span class="status-text">${o.meeting ? `The ${esc(o.meeting.title)} is still running.` : 'Meetings happen in the Meetings channel.'}</span>
    </div>
    <div class="section-title">${icon('calendar', 13)} Rest of the sprint</div>
    <div class="upcoming">${o.upcoming.map((d) => `<div class="card"><div class="d">Day ${d.day}<span>${d.date}</span></div>${d.meetings.map((m) => `<div class="m"><code>${m.time}</code>${esc(m.title)}</div>`).join('')}</div>`).join('') || '<div class="card muted">This is the last day of the sprint.</div>'}</div>`;
  const typeSel = $('adhoc-type');
  const sync = () => ($('adhoc-ticket-wrap').hidden = typeSel.value !== 'refinement');
  typeSel.onchange = sync; sync();
  $('adhoc-start').onclick = () => startMeeting(typeSel.value, typeSel.value === 'refinement' ? $('adhoc-ticket').value : undefined);
  feed.querySelectorAll('[data-meet]').forEach((b) => (b.onclick = () => startMeeting(b.dataset.meet, b.dataset.ticketFrom ? $(b.dataset.ticketFrom).value : undefined)));
}
async function startMeeting(type, ticket) {
  if (type === 'refinement' && !ticket) return toast('Pick a ticket to refine.');
  const r = await api('/api/meetings/start', { type, ticket });
  if (r) { OFFICE = r; location.hash = '#chat/meetings'; }
}
async function endMeeting() { const r = await api('/api/meetings/end', {}); if (r) { OFFICE = r; renderFrame(); } }
async function startDay() { const r = await api('/api/office/start-day', {}); if (r) { OFFICE = r; render(); location.hash = '#calendar'; } }
function confirmEndDay() {
  modal({
    title: `End day ${OFFICE.day}?`,
    sub: 'Everyone heads off to finish their day.',
    body: `<p>Each teammate who's in today does a realistic day's work on their own: devs write code and commit on their branches, review each other, fix bugs and update the board. Priya reviews the day. Then they message you about anything you need to know, and the day's recap is posted in General.</p>
      <p>This takes a few minutes and uses a Claude run for each teammate. Before you go, check you've given your standup update and written down what you tested today.</p>`,
    actions: [{ label: 'Not yet' }, { label: `End day ${OFFICE.day}`, primary: true, run: async () => { const r = await api('/api/office/end-day', {}); if (r) { OFFICE = r; renderFrame(); location.hash = '#chat/general'; } } }],
  });
}

// ================= board =================
const QA_COLS = ['Ready for QA', 'In QA', 'QA Passed', 'Reopened'];
const COL_COLOR = { Backlog: 'var(--text-3)', Ready: '#5aa9e6', 'In Progress': '#4c8dff', 'Code Review': 'var(--meet)', 'Ready for QA': 'var(--warn)', 'In QA': 'var(--accent)', 'QA Passed': 'var(--ok)', Reopened: 'var(--bad)', Done: 'var(--ok)' };
const ownerChip = (key, name) => key && S.people[key] ? `<span class="owner">${avatarHTML(key, 'xs')}${esc(S.people[key].short)}</span>` : `<span class="muted">${esc(name || '—')}</span>`;
function renderBoard() {
  const feed = $('feed'); feed.className = 'page';
  if (!BOARD) { feed.innerHTML = '<p class="muted">Loading the board…</p>'; return; }
  const actions = (t) => {
    const a = [];
    if (t.status === 'Ready for QA' || t.status === 'Reopened') a.push(`<button class="btn sm primary" data-move="start-testing" data-id="${t.id}">${icon('play', 11, 2.2)} Start testing</button>`);
    if (t.status === 'In QA') a.push(`<button class="btn sm primary" data-move="pass" data-id="${t.id}">${icon('check', 12, 2.4)} Pass QA</button>`);
    if (['Ready for QA', 'In QA', 'QA Passed'].includes(t.status)) a.push(`<button class="btn sm danger" data-move="reopen" data-id="${t.id}">Reopen</button>`);
    if (t.status === 'Backlog' && t.type === 'Story') a.push(`<button class="btn sm" data-refine="${t.id}">${icon('search', 12)} Refine</button>`);
    if (!['Backlog', 'Ready', 'Done'].includes(t.status)) a.push(`<button class="btn sm ghost" data-bug="${t.id}">${icon('bug', 12)} Bug</button>`);
    return a.length ? `<div class="acts">${a.join('')}</div>` : '';
  };
  const card = (t) => `<div class="tcard"><div class="top-line"><a class="id" href="#doc/${idPath(t.id) ?? ''}">${t.id}</a>${t.points && t.points !== '—' ? `<span class="tag">${esc(t.points)} pt</span>` : `<span class="tag">${esc(t.type)}</span>`}</div>
    <div class="ttl md">${inline(t.title, 'team/board.md')}</div>
    <div class="foot">${ownerChip(t.ownerKey, t.owner)}${t.branch ? `<code>${esc(t.branch)}</code>` : ''}${t.bugs ? `<span class="tag bad">${icon('bug', 11)} <span class="md">${inline(t.bugs, 'team/board.md')}</span></span>` : ''}</div>${actions(t)}</div>`;
  const cols = BOARD.statuses.map((s) => {
    const ts = BOARD.tickets.filter((t) => t.status === s);
    return `<div class="col ${QA_COLS.includes(s) ? 'qa' : ''}"><h3><span class="sdot" style="background:${COL_COLOR[s]}"></span>${s}${QA_COLS.includes(s) ? '<span class="you">QA</span>' : ''}<span class="n">${ts.length}</span></h3>${ts.map(card).join('') || '<div class="col-empty">Nothing here</div>'}</div>`;
  }).join('');
  const other = BOARD.tickets.filter((t) => !BOARD.statuses.includes(t.status));
  const sevTag = (s) => `<span class="tag ${/Sev-1/.test(s) ? 'bad' : /Sev-2/.test(s) ? 'warn' : ''}">${esc(s)}</span>`;
  const bugState = (s) => `<span class="tag ${/^closed/i.test(s) ? 'ok' : /^fixed/i.test(s) ? 'accent' : /^reopened/i.test(s) ? 'bad' : /^new/i.test(s) ? 'warn' : ''}"><span class="pip"></span>${esc(s)}</span>`;
  const bugRows = BOARD.bugs.map((b) => `<tr><td class="mono"><a href="#doc/${idPath(b.id) ?? ''}">${b.id}</a></td><td>${esc(b.title)}</td><td>${sevTag(b.severity)}</td><td>${esc(b.priority)}</td><td class="mono">${b.ticket ? `<a href="#doc/${idPath(b.ticket) ?? ''}">${b.ticket}</a>` : '—'}</td><td>${ownerChip(b.ownerKey, b.owner)}</td><td>${bugState(b.status)}</td>
    <td>${/^fixed/i.test(b.status) ? `<div class="row-actions"><button class="btn sm primary" data-verify="close" data-id="${b.id}">${icon('check', 12, 2.4)} Close</button><button class="btn sm danger" data-verify="reopen" data-id="${b.id}">Still failing</button></div>` : ''}</td></tr>`).join('');
  const qaCount = BOARD.tickets.filter((t) => ['Ready for QA', 'Reopened'].includes(t.status)).length;
  feed.innerHTML = `
    <div class="page-head"><div><h1>Sprint ${OFFICE?.sprint ?? 1} board</h1><p>${esc(BOARD.goal)}</p></div>
      <div class="row-actions">${qaCount ? `<span class="tag warn">${qaCount} waiting for QA</span>` : ''}<a class="btn" href="#doc/team/board.md">${icon('doc', 14)} As document</a><button class="btn primary" data-bug="">${icon('bug', 14)} File a bug</button></div></div>
    <div class="kanban">${cols}</div>
    ${other.length ? `<p class="muted">Not in a known column: ${other.map((t) => `${t.id} (${esc(t.status)})`).join(', ')}</p>` : ''}
    <div class="section-title">${icon('bug', 13)} Bugs</div>
    ${BOARD.bugs.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>ID</th><th>Title</th><th>Severity</th><th>Priority</th><th>Ticket</th><th>Owner</th><th>Status</th><th></th></tr></thead><tbody>${bugRows}</tbody></table></div>` : '<div class="card muted">No bugs filed yet. When you find one, use <b>File a bug</b>.</div>'}`;
  feed.querySelectorAll('[data-move]').forEach((b) => (b.onclick = () => moveTicket(b.dataset.id, b.dataset.move)));
  feed.querySelectorAll('[data-refine]').forEach((b) => (b.onclick = () => (OFFICE?.phase === 'working' ? startMeeting('refinement', b.dataset.refine) : toast('Start the day first.'))));
  feed.querySelectorAll('[data-bug]').forEach((b) => (b.onclick = () => bugForm(b.dataset.bug)));
  feed.querySelectorAll('[data-verify]').forEach((b) => (b.onclick = () => verifyBug(b.dataset.id, b.dataset.verify)));
}
async function moveTicket(id, action) {
  const t = BOARD.tickets.find((x) => x.id === id);
  const owner = S.people[t?.ownerKey]?.short ?? 'the owner';
  const copy = {
    'start-testing': { title: `Start testing ${id}`, sub: 'Moves it to In QA. You can note the build you are testing.', ph: 'e.g. Testing the IT-103 branch at commit abc1234 (optional)', required: false, label: 'Start testing' },
    pass: { title: `Pass QA on ${id}`, sub: `This signs it off. ${owner} is told they can merge.`, ph: 'What you verified, and anything left open (optional)', required: false, label: 'Pass QA' },
    reopen: { title: `Reopen ${id}`, sub: `Sends it back to ${owner}. Say what fails and link the bug.`, ph: 'Fails acceptance criterion 2: see BUG-002', required: true, label: 'Reopen' },
  }[action];
  const comment = await askText(copy);
  if (comment === null) return;
  const r = await api('/api/board/move', { id, action, comment });
  if (r) { BOARD = r; renderBoard(); toast(`${id} updated.`, 2500, 'check'); }
}
async function verifyBug(id, result) {
  const comment = await askText(result === 'close'
    ? { title: `Close ${id}`, sub: 'You retested it and it is fixed.', ph: 'How you retested it (optional)', required: false, label: 'Close bug' }
    : { title: `${id} still fails`, sub: 'It goes back to the owner.', ph: 'What still fails, with the output', required: true, label: 'Reopen bug' });
  if (comment === null) return;
  const r = await api('/api/bugs/verify', { id, result, comment });
  if (r) { BOARD = r; renderBoard(); }
}

// ================= bug form =================
function bugForm(ticket = '') {
  const tickets = BOARD?.tickets ?? [];
  const branches = [...new Set(['main', ...BUILDS.map((b) => b.branch)])];
  const t = tickets.find((x) => x.id === ticket);
  const field = (name, lab, input, hint = '') => `<div class="field"><label for="bf-${name}">${lab}</label>${input}${hint ? `<small>${hint}</small>` : ''}</div>`;
  const sevs = [['Sev-1', 'Critical'], ['Sev-2', 'Major'], ['Sev-3', 'Minor'], ['Sev-4', 'Trivial']];
  const body = `<form class="bugform" id="bugform" autocomplete="off"><div style="display:grid;gap:14px">
    ${field('title', 'Title', `<input id="bf-title" name="title" placeholder="What is wrong, and where" required>`, 'Like "check --json prints markdown when the plan file is missing", not "JSON broken"')}
    <div class="two">
      ${field('ticket', 'Found while testing', `<select id="bf-ticket" name="ticket"><option value="">Existing feature (not a sprint ticket)</option>${tickets.map((x) => `<option value="${x.id}" ${x.id === ticket ? 'selected' : ''}>${x.id} · ${esc(plain(x.title)).slice(0, 40)}</option>`).join('')}</select>`)}
      ${field('branch', 'Branch or commit', `<input id="bf-branch" name="branch" list="bf-branches" value="${esc(t?.branch || 'main')}"><datalist id="bf-branches">${branches.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>`)}
    </div>
    <div class="field"><label>Proposed severity</label><div class="sev">${sevs.map(([s, d]) => `<label><input type="radio" name="severity" value="${s}">${s}<small>${d}</small></label>`).join('')}</div>
      <input name="severityReason" placeholder="Because… (one line)"></div>
    ${field('steps', 'Steps to reproduce', `<textarea id="bf-steps" name="steps" rows="4" placeholder="One step per line: exact commands, files and clicks"></textarea>`)}
    <div class="two">
      ${field('expected', 'Expected result', `<textarea id="bf-expected" name="expected" rows="3"></textarea>`)}
      ${field('actual', 'Actual result', `<textarea id="bf-actual" class="mono" name="actual" rows="3" placeholder="Paste the real output"></textarea>`)}
    </div>
    <div class="two">
      ${field('os', 'OS', `<input id="bf-os" name="os" value="Windows 11">`)}
      ${field('vscode', 'VS Code version', `<input id="bf-vscode" name="vscode" placeholder="Editor bugs only">`)}
    </div>
    ${field('evidence', 'Evidence', `<textarea id="bf-evidence" name="evidence" rows="2" placeholder="Output, a sample file in team/qa/, or a screenshot path"></textarea>`)}
    ${field('notes', 'Notes', `<textarea id="bf-notes" name="notes" rows="2" placeholder="How often it happens, workarounds, related bugs"></textarea>`)}
  </div>
  <aside class="rubric"><b>${icon('sparkle', 14)} What Priya looks for</b><ol>
    <li>The title says what's wrong and where</li><li>Steps someone else can paste and repeat</li><li>Expected and actual kept separate, quoting real output</li>
    <li>Environment: branch or commit</li><li>Evidence</li><li>Severity with a one-line reason</li><li>One bug per report, with no blame</li></ol>
    <p>It's filed as <b>New</b> on the board, and Priya triages it.</p></aside></form>`;
  modal({
    title: 'File a bug', sub: 'Creates the report in team/bugs/, adds it to the board and posts it in #Bugs.', body, big: true,
    actions: [{ label: 'Cancel' }, { label: 'File bug', primary: true, run: async () => {
      const f = Object.fromEntries(new FormData($('bugform')).entries());
      if (!f.title?.trim()) { toast('Give the bug a title.', 3000, 'alert'); return false; }
      if (!f.severity) { toast('Propose a severity.', 3000, 'alert'); return false; }
      const r = await api('/api/bugs', f);
      if (!r) return false;
      toast(`Filed ${r.id}.`, 3000, 'bug');
      BOARD = await api('/api/board'); await refreshFiles();
      location.hash = `#doc/team/bugs/${r.id}.md`;
    } }],
  });
  setTimeout(() => $('bf-title')?.focus(), 50);
}

// ================= builds =================
function renderBuilds() {
  const feed = $('feed'); feed.className = 'page';
  const ic = { passed: 'check', failed: 'x', running: 'refresh', queued: 'clock', stale: 'clock' };
  const rows = BUILDS.map((b) => {
    const tests = b.tests ? `${b.tests.passed} passed${b.tests.failed ? ` · ${b.tests.failed} failed` : ''}` : b.stage === 'compile' && b.status === 'failed' ? "doesn't compile" : '';
    const meta = [b.sha ? `<span><code>${b.sha.slice(0, 7)}</code> ${esc(b.subject ?? '')}</span>` : '', tests && `<span>${tests}</span>`, b.duration ? `<span>${b.duration}s</span>` : '', `<span>${b.finishedAt && !['running', 'queued'].includes(b.status) ? ago(new Date(b.finishedAt).getTime()) : b.status}</span>`].filter(Boolean).join('');
    const ticket = (b.branch.match(/^(IT-\d+|QA-\d+)/) ?? [])[1];
    return `<div class="card build"><span class="st ${b.status}">${icon(ic[b.status] ?? 'clock', 17, 2.2).replace('class="i"', `class="i ${b.status === 'running' ? 'spin' : ''}"`)}</span>
      <div style="min-width:0"><div class="br">${icon('branch', 14)}${esc(b.branch)} ${ticket ? `<a class="tag accent" href="#doc/${idPath(ticket) ?? ''}">${ticket}</a>` : ''}</div><div class="meta">${meta}</div></div>
      <div class="row-actions">${b.log ? `<button class="btn sm ghost" data-log="${esc(b.branch)}">${icon('terminal', 13)} ${openLogs.has(b.branch) ? 'Hide log' : 'Log'}</button>` : ''}<button class="btn sm" data-rerun="${esc(b.branch)}" ${b.status === 'running' || b.status === 'queued' ? 'disabled' : ''}>${icon('refresh', 13)} Re-run</button></div>
      ${openLogs.has(b.branch) && b.log ? `<pre>${esc(b.log)}</pre>` : ''}</div>`;
  }).join('');
  const n = (s) => BUILDS.filter((b) => b.status === s).length;
  feed.innerHTML = `<div class="page-head"><div><h1>Builds</h1><p>CI compiles and tests every branch whenever it gets a new commit, checking every 30 seconds. Test a ticket only once its branch is green.</p></div></div>
    <div class="stats"><div class="card stat"><div class="k">Branches</div><div class="v">${BUILDS.length}</div></div><div class="card stat"><div class="k">Passing</div><div class="v" style="color:var(--ok)">${n('passed')}</div></div><div class="card stat"><div class="k">Failing</div><div class="v" style="color:${n('failed') ? 'var(--bad)' : 'var(--text)'}">${n('failed')}</div></div><div class="card stat"><div class="k">Running</div><div class="v">${n('running') + n('queued')}</div></div></div>
    <div class="section-title">${icon('branch', 13)} Branches</div>
    <div class="builds">${rows || '<div class="card muted">No branches yet. Builds appear when a dev starts a ticket in a worktree.</div>'}</div>`;
  feed.querySelectorAll('[data-log]').forEach((b) => (b.onclick = () => { const k = b.dataset.log; openLogs.has(k) ? openLogs.delete(k) : openLogs.add(k); renderBuilds(); }));
  feed.querySelectorAll('[data-rerun]').forEach((b) => (b.onclick = () => api('/api/builds/run', { branch: b.dataset.rerun })));
}

// ================= handbook =================
async function renderDoc({ keepScroll = false, changed = false } = {}) {
  const feed = $('feed');
  feed.className = 'page'; feed.style.padding = '0';
  const top = feed.scrollTop;
  const r = await fetch('/api/file?path=' + encodeURIComponent(docPath)).catch(() => null);
  if (view !== 'docs') return;
  if (!r || !r.ok) { feed.innerHTML = `<div class="reader"><article class="article md"><h1>Not found</h1><p>${esc(docPath)} doesn't exist yet. <a href="#doc/team/README.md">Back to Start here</a></p></article></div>`; return; }
  const f = await r.json();
  const { html, toc } = md(f.text, { base: f.path });
  const sec = sections().find((s) => s.items.some((x) => x.path === f.path));
  const idx = sec ? sec.items.findIndex((x) => x.path === f.path) : -1;
  const prev = idx > 0 ? sec.items[idx - 1] : null, next = sec && idx < sec.items.length - 1 ? sec.items[idx + 1] : null;
  const pager = sec && (prev || next) ? `<nav class="pager">${prev ? `<a href="#doc/${prev.path}"><small>← Previous</small>${esc(label(prev))}</a>` : ''}${next ? `<a class="next" href="#doc/${next.path}"><small>Next →</small>${esc(label(next))}</a>` : ''}</nav>` : '';
  const id = (f.path.match(/(IT-\d+|QA-\d+|BUG-\d+)\.md$/) ?? [])[1];
  const bugBtn = id && !id.startsWith('BUG') ? `<button class="btn sm ghost" data-filebug="${id}">${icon('bug', 12)} File a bug</button>` : '';
  feed.innerHTML = `<div class="reader"><article class="article md">
      <div class="crumbs"><span class="path">${icon(docIcon(f.path), 14)}${esc(sec ? sec.name : 'Handbook')} / ${esc(f.path.replace(/^team\//, ''))}</span><span class="acts">${changed ? '<span class="fresh">Updated just now</span>' : `<span>Updated ${ago(f.modified)}</span>`}${bugBtn}<a class="btn sm ghost" href="vscode://file/${encodeURI(f.abs.replace(/\\/g, '/'))}">${icon('ext', 12)} VS Code</a></span></div>
      ${html}${pager}</article>
      ${toc.length >= 3 ? `<aside class="toc"><b>On this page</b>${toc.map((t) => `<a href="#" data-anchor="${t.id}">${esc(t.text)}</a>`).join('')}</aside>` : ''}</div>`;
  feed.scrollTop = keepScroll ? top : 0;
  feed.querySelectorAll('[data-filebug]').forEach((a) => (a.onclick = () => bugForm(a.dataset.filebug)));
  markRead(f.path, f.modified);
  const entry = FILES.find((x) => x.path === f.path); if (entry) entry.modified = f.modified;
  renderSide(); renderRail();
}

// ================= modal =================
function modal({ title, sub = '', body = '', actions = [], big = false }) {
  const root = $('modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal ${big ? 'big' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</header><div class="body">${body}</div>
    <footer>${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''}" data-act="${i}">${esc(a.label)}</button>`).join('')}</footer></div></div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('.modal-bg').addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-bg')) close(); });
  root.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    const a = actions[+b.dataset.act];
    if (!a.run) return close();
    b.disabled = true;
    const keep = (await a.run()) === false;
    b.disabled = false;
    if (!keep) close();
  }));
  return close;
}
function askText({ title, sub, ph, required, label }) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, sub, body: `<div class="field"><textarea id="ask-text" rows="4" placeholder="${esc(ph)}"></textarea></div>`,
      actions: [{ label: 'Cancel', run: () => { done = true; resolve(null); } }, { label, primary: true, run: () => {
        const v = $('ask-text').value.trim();
        if (required && !v) { toast('Please add a comment.', 3000, 'alert'); return false; }
        done = true; resolve(v);
      } }],
    });
    const obs = new MutationObserver(() => { if (!$('modal-root').children.length) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe($('modal-root'), { childList: true });
    setTimeout(() => $('ask-text')?.focus(), 30);
  });
}

// ================= notifications =================
function renderBell() { $('bell').innerHTML = icon(bellOn ? 'bell' : 'bellOff', 17); $('bell').classList.toggle('on', bellOn); $('bell').title = bellOn ? 'Desktop notifications are on' : 'Turn on desktop notifications'; }
$('bell').onclick = async () => {
  if (!bellOn && 'Notification' in window && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission().catch(() => 'denied');
    if (p !== 'granted') return toast('Notifications are blocked in this browser.', 3500, 'alert');
  }
  bellOn = !bellOn; save('office.bell', bellOn); renderBell(); toast(bellOn ? 'You will be notified about DMs, @mentions and meetings.' : 'Notifications off.', 3000, bellOn ? 'bell' : 'bellOff');
};
let audio;
function beep() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = 784; g.gain.setValueAtTime(0.05, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.3);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.31);
  } catch {}
}
function maybeNotify(m) {
  if (m.from === 'samin') return;
  const forMe = m.channel.startsWith('dm-') || /@samin\b/i.test(m.text) || /your turn, samin/i.test(m.text) || (m.from === 'ci' && /❌/.test(m.text));
  const looking = !document.hidden && view === 'chat' && current === m.channel;
  if (!forMe || looking) return;
  if (bellOn) {
    beep();
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      const who = S.people[m.from]?.name ?? 'Team Office';
      const n = new Notification(`${who}${m.channel.startsWith('dm-') ? '' : ' in #' + (S.channels.find((c) => c.id === m.channel)?.name ?? m.channel)}`, { body: m.text.replace(LEADING, '').replace(/[*_`#>]/g, '').slice(0, 160), tag: m.channel });
      n.onclick = () => { window.focus(); location.hash = '#chat/' + m.channel; n.close(); };
    }
  }
  if (document.hidden) document.title = '• Team Office';
}

// ================= routing =================
function renderFrame() { renderClock(); renderBanner(); renderRail(); renderSide(); renderHead(); renderCompose(); }
function render() {
  $('feed').style.padding = '';
  renderFrame(); renderTyping();
  if (view === 'chat') renderFeed();
  else if (view === 'calendar') renderCalendar();
  else if (view === 'board') renderBoard();
  else if (view === 'builds') renderBuilds();
  else renderDoc();
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const prevView = view, prevDoc = docPath;
  if (h === 'doc' || h.startsWith('doc/')) {
    view = 'docs';
    docPath = h.slice(4) || load('office.lastDoc', 'team/README.md');
    save('office.lastDoc', docPath);
  } else if (['calendar', 'board', 'builds'].includes(h)) view = h;
  else {
    view = 'chat';
    const ch = h.slice(5);
    if (h.startsWith('chat/') && S.channels.some((c) => c.id === ch)) current = ch;
    renderFeed.jump = true;
  }
  if (prevView !== view) { search = ''; $('search').value = ''; }
  $('side').classList.remove('open');
  if (view === 'docs' && prevView === 'docs' && prevDoc === docPath) return;
  render();
  if (view === 'chat') $('input').focus();
}
window.addEventListener('hashchange', route);
$('menu').onclick = () => $('side').classList.toggle('open');
$('search').oninput = (e) => { search = e.target.value; view === 'chat' ? renderFeed() : view === 'docs' ? renderDocNav() : null; };
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '') && !$('search').disabled) { e.preventDefault(); $('search').focus(); }
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-anchor],[data-pick],[data-go]');
  if (!a) return;
  if (a.dataset.go) { location.hash = a.dataset.go === '#chat' ? `#chat/${current}` : a.dataset.go; return; }
  if (a.dataset.pick) return pick(+a.dataset.pick);
  e.preventDefault();
  document.getElementById(a.dataset.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ================= mentions & sending =================
let popItems = [], popIndex = 0;
function updatePop() {
  const ta = $('input'), m = ta.value.slice(0, ta.selectionStart).match(/(^|\s)@(\w*)$/);
  if (!m) return hidePop();
  const q = m[2].toLowerCase();
  popItems = [...['priya', 'rafi', 'mei', 'jonas'].map((id) => ({ key: S.people[id].short, label: S.people[id].name, sub: `${S.people[id].role} · ${STATUS_TEXT[presence(id)]}`, id })), { key: 'team', label: '@team', sub: 'Everyone on the team' }]
    .filter((x) => x.key.toLowerCase().startsWith(q));
  if (!popItems.length) return hidePop();
  popIndex = Math.min(popIndex, popItems.length - 1);
  $('pop').innerHTML = popItems.map((x, i) => `<button data-pick="${i}" class="${i === popIndex ? 'on' : ''}">${x.id ? avatarHTML(x.id, 'sm') : `<span class="chan-ico" style="width:24px;height:24px;border-radius:7px">${icon('users', 13)}</span>`}<span>${esc(x.label)}<small>${esc(x.sub)}</small></span></button>`).join('');
  $('pop').classList.add('show');
}
function hidePop() { $('pop').classList.remove('show'); popItems = []; popIndex = 0; }
function pick(i) {
  const ta = $('input'), pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@\w*$/, '@' + popItems[i].key + ' ');
  ta.value = before + ta.value.slice(pos); ta.selectionStart = ta.selectionEnd = before.length; hidePop(); ta.focus(); grow();
}
function grow() { const ta = $('input'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; $('send').disabled = !ta.value.trim(); }
async function sendMsg() {
  const text = $('input').value.trim(); if (!text) return;
  $('input').value = ''; grow(); renderFeed.jump = true;
  const r = await api('/api/send', { channel: current, text });
  if (!r) { $('input').value = text; grow(); }
}
$('send').onclick = sendMsg;
$('input').addEventListener('input', () => { grow(); updatePop(); });
$('input').addEventListener('keydown', (e) => {
  if ($('pop').classList.contains('show')) {
    if (e.key === 'ArrowDown') { popIndex = (popIndex + 1) % popItems.length; updatePop(); return e.preventDefault(); }
    if (e.key === 'ArrowUp') { popIndex = (popIndex - 1 + popItems.length) % popItems.length; updatePop(); return e.preventDefault(); }
    if (e.key === 'Enter' || e.key === 'Tab') { pick(popIndex); return e.preventDefault(); }
    if (e.key === 'Escape') return hidePop();
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});

// ================= live updates =================
async function refreshFiles() { FILES = (await api('/api/files')) ?? FILES; }
let filesTimer;
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'message') {
      (S.messages[ev.message.channel] ||= []).push(ev.message);
      maybeNotify(ev.message);
      if (ev.message.channel === current && view === 'chat') renderFeed();
      if (view !== 'docs') renderSide(); renderRail();
    } else if (ev.type === 'presence') {
      S.statuses = ev.statuses; S.typing = new Set(ev.typing);
      renderTyping(); if (view === 'chat') { renderSide(); renderHead(); }
    } else if (ev.type === 'office') {
      OFFICE = ev.office; S.statuses = ev.office.statuses ?? S.statuses;
      renderFrame(); if (view === 'calendar') renderCalendar();
    } else if (ev.type === 'builds') {
      BUILDS = ev.builds; renderRail(); if (view === 'builds') renderBuilds();
    } else if (ev.type === 'files') {
      clearTimeout(filesTimer);
      filesTimer = setTimeout(async () => {
        await refreshFiles();
        if (ev.paths.includes('team/board.md')) { BOARD = (await api('/api/board')) ?? BOARD; if (view === 'board') renderBoard(); }
        if (view === 'docs' && ev.paths.includes(docPath)) renderDoc({ keepScroll: true, changed: true });
        else { if (view === 'docs') renderDocNav(); renderRail(); }
      }, 250);
    }
  };
  es.onerror = () => { if (view === 'chat') $('typing').textContent = 'Reconnecting to the office server…'; };
  es.onopen = () => renderTyping();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'Team Office'; });

(async () => {
  renderTheme(); renderBell();
  const st = await api('/api/state');
  if (!st) return;
  S = { ...st, typing: new Set(st.typing) };
  OFFICE = st.office;
  [BOARD, BUILDS] = await Promise.all([api('/api/board'), api('/api/builds')]);
  BUILDS ??= [];
  await refreshFiles();
  if (!location.hash) location.replace('#chat/general');
  route(); grow();
  if (!/[?&]nolive\b/.test(location.search)) connect(); // ?nolive: a static snapshot, used for screenshots
})();
