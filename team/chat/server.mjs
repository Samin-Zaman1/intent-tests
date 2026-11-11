#!/usr/bin/env node
// The Intent Tests office: chat, calendar and meetings, board, bug tracker, CI and handbook for the simulated team.
// Usage: npm run team-chat   (then open http://localhost:4321)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CHANNELS, HERE, PEOPLE, REPO, append, channel, clients, load, notify } from './lib/store.mjs';
import { CLAUDE, MODEL_NAME, deliver, mentionsIn, statuses, typingKeys } from './lib/agents.mjs';
import { createBug, logActivity, readBoard, setBugStatus, setTicketStatus } from './lib/board.mjs';
import { checkEndDay, checkEndMeeting, checkMeeting, dayLabel, endDay, endMeeting, meetingMessage, officeView, startDay, startMeeting } from './lib/office.mjs';
import { listBuilds, rerun, startCI } from './lib/ci.mjs';

const PORT = Number(process.env.TEAM_CHAT_PORT ?? 4321);
const TEAM_DIR = path.join(REPO, 'team');
const SEEDED = path.join(TEAM_DIR, '.seeded');

// ---------- helpers ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
  });
}
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
const fail = (message) => Object.assign(new Error(message), { status: 400 });
const guard = (check) => { try { check(); } catch (e) { throw fail(e.message); } };

/** Who answers a message from Samin outside a meeting. */
function recipients(ch, text) {
  const c = channel(ch);
  if (c.kind === 'dm') return [c.person];
  const named = mentionsIn(text);
  return named.length ? named : ['priya']; // the lead keeps an eye on every channel
}

function listTeamFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'chat') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.md')) {
        const title = (fs.readFileSync(abs, 'utf8').match(/^#\s+(.+)$/m) ?? [])[1]?.trim();
        out.push({ path: path.relative(REPO, abs).split(path.sep).join('/'), modified: fs.statSync(abs).mtimeMs, title });
      }
    }
  };
  walk(TEAM_DIR);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------- board actions (what QA is allowed to do on the board) ----------
const QA_ACTIONS = {
  'start-testing': { from: ['Ready for QA', 'Reopened'], to: 'In QA' },
  pass: { from: ['In QA'], to: 'QA Passed' },
  reopen: { from: ['Ready for QA', 'In QA', 'QA Passed'], to: 'Reopened', needsComment: true },
};
function moveTicket({ id, action, comment = '' }) {
  const a = QA_ACTIONS[action];
  if (!a) throw fail('Unknown action.');
  const t = readBoard().tickets.find((x) => x.id === id);
  if (!t) throw fail(`${id} isn't on the board.`);
  if (!a.from.includes(t.status)) throw fail(`${id} is ${t.status}. You can do that from ${a.from.join(' or ')}.`);
  if (a.needsComment && !comment.trim()) throw fail('Say why you are reopening it (and link the bug).');
  setTicketStatus(id, a.to);
  logActivity(id, `Samin moved it from ${t.status} to ${a.to}.${comment ? ` ${comment.trim()}` : ''}`, dayLabel());
  const owner = t.ownerKey, at = owner && PEOPLE[owner] ? ` @${PEOPLE[owner].short}` : '';
  if (action === 'start-testing') {
    notify('sprint-1', `🧪 **Samin** started testing **${id}** (${t.status} → In QA).${comment ? `\n\n${comment}` : ''}`);
  } else {
    const text = action === 'pass'
      ? `✅ **${id} passed QA.**${comment ? ` ${comment.trim()}` : ''}${at} it's signed off, so you can merge it.`
      : `🔁 **${id} is reopened.** ${comment.trim()}${at}`;
    const msg = append('sprint-1', { from: 'samin', text });
    if (owner && PEOPLE[owner]?.agent) deliver(owner, 'sprint-1', msg);
  }
}

function fileBug(f) {
  if (!String(f.title ?? '').trim()) throw fail('A bug needs a title.');
  if (!/^Sev-[1-4]$/.test(f.severity ?? '')) throw fail('Pick a proposed severity.');
  const id = createBug(f, dayLabel());
  const msg = append('bugs', { from: 'samin', text: `🐞 Filed **${id}**: ${f.title.trim()}\n\nProposed ${f.severity}${f.ticket ? `, against ${f.ticket}` : ''}. [Open the report](team/bugs/${id}.md)` });
  deliver('priya', 'bugs', msg, { extra: `Samin just filed ${id} (team/bugs/${id}.md). Acknowledge it briefly. Formal triage happens at the triage meeting, unless it looks like a Sev-1. If the Coaching setting is "always", also give quick feedback on the report against the rubric.` });
  return id;
}

function verifyBug({ id, result, comment = '' }) {
  const b = readBoard().bugs.find((x) => x.id === id);
  if (!b) throw fail(`${id} isn't on the board.`);
  if (result === 'reopen' && !comment.trim()) throw fail('Say what still fails.');
  const to = result === 'close' ? 'Closed' : 'Reopened';
  setBugStatus(id, to);
  logActivity(id, `Samin retested it: ${to.toLowerCase()}.${comment ? ` ${comment.trim()}` : ''}`, dayLabel());
  const at = b.ownerKey && PEOPLE[b.ownerKey]?.agent ? ` @${PEOPLE[b.ownerKey].short}` : '';
  const msg = append('bugs', { from: 'samin', text: to === 'Closed' ? `✔️ Retested **${id}**: fixed, closing it.${comment ? ` ${comment.trim()}` : ''}${at}` : `🔁 Retested **${id}**: still failing. ${comment.trim()}${at}` });
  if (b.ownerKey && PEOPLE[b.ownerKey]?.agent && to === 'Reopened') deliver(b.ownerKey, 'bugs', msg);
}

// ---------- http ----------
const routes = {
  'GET /api/state': () => ({
    repo: REPO.split(path.sep).join('/'), people: PEOPLE, channels: CHANNELS,
    messages: Object.fromEntries(CHANNELS.map((c) => [c.id, load(c.id)])), typing: typingKeys(),
    statuses: statuses(), office: officeView(),
  }),
  'GET /api/files': () => listTeamFiles(),
  'GET /api/board': () => readBoard(),
  'GET /api/builds': () => listBuilds(),
  'POST /api/send': ({ channel: ch, text }) => {
    if (!channel(ch) || typeof text !== 'string' || !text.trim()) throw fail('Bad message.');
    const msg = append(ch, { from: 'samin', text: text.trim() });
    if (ch === 'meetings' && meetingMessage(msg)) return { ok: true };
    for (const person of recipients(ch, msg.text)) deliver(person, ch, msg);
    return { ok: true };
  },
  'POST /api/board/move': (body) => { moveTicket(body); return readBoard(); },
  'POST /api/bugs': (body) => ({ id: fileBug(body) }),
  'POST /api/bugs/verify': (body) => { verifyBug(body); return readBoard(); },
  'POST /api/builds/run': ({ branch }) => rerun(branch).then(() => ({ ok: true })),
  'POST /api/office/start-day': () => startDay(),
  // These take minutes, so they run in the background, but bad requests are refused first.
  'POST /api/office/end-day': () => { guard(checkEndDay); endDay().catch((e) => notify('general', `⚠️ The end of the day didn't finish: ${e.message}`)); return officeView(); },
  'POST /api/meetings/start': ({ type, ticket }) => { guard(() => checkMeeting(type, { ticket })); startMeeting(type, { ticket }).catch((e) => notify('meetings', `⚠️ ${e.message}`)); return officeView(); },
  'POST /api/meetings/end': () => { guard(checkEndMeeting); endMeeting().catch((e) => notify('meetings', `⚠️ ${e.message}`)); return officeView(); },
};

const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'] };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [name, type] = STATIC[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(HERE, name)), type);
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    // Read-only view of team files. Never serves team/.seeded/ (the answer key).
    if (req.method === 'GET' && url.pathname === '/api/file') {
      const abs = path.resolve(REPO, (url.searchParams.get('path') ?? '').replace(/\\/g, '/'));
      if (!abs.startsWith(TEAM_DIR + path.sep) || abs.startsWith(SEEDED + path.sep) || !abs.endsWith('.md') || !fs.existsSync(abs)) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { path: path.relative(REPO, abs).split(path.sep).join('/'), abs, modified: fs.statSync(abs).mtimeMs, text: fs.readFileSync(abs, 'utf8') });
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'Not found' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    send(res, 200, await handler(body));
  } catch (e) {
    send(res, e.status ?? 500, { error: e.message });
  }
});

// Tell open pages when a team file changes (a teammate moved a ticket, filed a bug…) so every view stays current.
const pending = new Set();
let flush;
try {
  fs.watch(TEAM_DIR, { recursive: true }, (_event, name) => {
    if (!name) return;
    const rel = 'team/' + String(name).split(path.sep).join('/');
    if (!rel.endsWith('.md') || rel.startsWith('team/.seeded/') || rel.startsWith('team/chat/')) return;
    pending.add(rel);
    clearTimeout(flush);
    flush = setTimeout(() => {
      const data = `data: ${JSON.stringify({ type: 'files', paths: [...pending] })}\n\n`;
      for (const c of clients) c.write(data);
      pending.clear();
    }, 300);
  });
} catch (e) {
  console.warn(`Live file updates are off: ${e.message}`);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`The office is open at http://localhost:${PORT}`);
  console.log(`Teammates answer through: ${CLAUDE}${MODEL_NAME ? ` (model: ${MODEL_NAME})` : ''}`);
  startCI();
});
