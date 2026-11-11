// Running teammates: each one is a Claude Code agent run headlessly (`claude -p --agent <name>`) from the repo root.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PEOPLE, REPO, TEAMMATES, append, broadcast, channel, load } from './store.mjs';

const MODEL = process.env.TEAM_CHAT_MODEL; // e.g. "sonnet" for cheaper replies
export const MAX_HOPS = 1;

function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const exts = path.join(os.homedir(), '.vscode', 'extensions');
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  if (fs.existsSync(exts)) {
    const found = fs.readdirSync(exts)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .map((d) => path.join(exts, d, 'resources', 'native-binary', exe))
      .filter((p) => fs.existsSync(p))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (found.length) return found[0];
  }
  return 'claude';
}
export const CLAUDE = findClaude();
export const MODEL_NAME = MODEL;

const ALLOWED_TOOLS = [
  'Read', 'Grep', 'Glob', 'Edit', 'Write',
  'Bash(git:*)', 'Bash(node:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(cd:*)', 'Bash(mkdir:*)',
  'Bash(../../node_modules/.bin/tsc:*)', 'Bash(../../node_modules/.bin/vitest:*)',
  'Bash(npx tsc:*)', 'Bash(npx vitest:*)', 'Bash(npm run compile:*)', 'Bash(npm test:*)',
];

// ---------- presence ----------
const busy = new Map(); // person -> number of runs in progress
const typing = new Map(); // `${channel}:${person}` -> true
let officeHooks = { isOut: () => false, inMeeting: () => false, context: () => '', queueForTomorrow: () => {} };
export const setOfficeHooks = (hooks) => (officeHooks = { ...officeHooks, ...hooks });

export function statuses() {
  return Object.fromEntries(TEAMMATES.map((p) => [p,
    officeHooks.isOut(p) ? 'out' : busy.get(p) ? 'busy' : officeHooks.inMeeting(p) ? 'meeting' : 'available']));
}
const pushPresence = () => broadcast({ type: 'presence', statuses: statuses(), typing: [...typing.keys()] });
export const typingKeys = () => [...typing.keys()];
function setTyping(ch, person, on) {
  const key = `${ch}:${person}`;
  on ? typing.set(key, true) : typing.delete(key);
  pushPresence();
}

// ---------- running ----------
const queues = new Map(); // one run at a time per teammate, so a journal is never edited twice at once
function enqueue(person, job) {
  const prev = queues.get(person) ?? Promise.resolve();
  const next = prev.then(job, job);
  queues.set(person, next.catch(() => {}));
  return next;
}

export function runAgent(person, prompt, { timeoutMs = 15 * 60e3 } = {}) {
  return enqueue(person, () => new Promise((resolve, reject) => {
    const args = ['-p', '--agent', PEOPLE[person].agent, '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED_TOOLS];
    if (MODEL) args.push('--model', MODEL);
    busy.set(person, (busy.get(person) ?? 0) + 1); pushPresence();
    const done = () => { busy.set(person, busy.get(person) - 1); pushPresence(); };
    const child = spawn(CLAUDE, args, { cwd: REPO, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); done(); reject(new Error(`Could not start Claude (${CLAUDE}): ${e.message}. Set CLAUDE_BIN to the path of claude.`)); });
    child.on('close', (code) => {
      clearTimeout(timer); done();
      try {
        const json = JSON.parse(out);
        if (json.is_error) return reject(new Error(json.result || 'Claude reported an error.'));
        resolve(String(json.result ?? '').trim());
      } catch {
        reject(new Error(code === null ? `Timed out after ${Math.round(timeoutMs / 60e3)} minutes.` : `Claude exited with ${code}. ${(err || out).trim().slice(0, 400)}`));
      }
    });
    child.stdin.end(prompt);
  }));
}

// ---------- prompt helpers ----------
export function transcript(ch, { limit = 20, since } = {}) {
  return load(ch)
    .filter((m) => !since || m.ts >= since)
    .slice(-limit)
    .map((m) => `[${m.ts.slice(0, 16).replace('T', ' ')}] ${PEOPLE[m.from]?.short ?? m.from}: ${m.text}`)
    .join('\n') || '(no messages yet)';
}

/** Splits the "---\n**Changes:** ..." trailer off a teammate's reply. */
export function splitChanges(reply) {
  const m = reply.match(/\n-{3,}\s*\n\s*\**Changes:?\**:?\s*([\s\S]*)$/i);
  if (!m) return { text: reply.trim(), changes: '' };
  const changes = m[1].trim();
  return { text: reply.slice(0, m.index).trim(), changes: /^none\.?$/i.test(changes) ? '' : changes };
}

/**
 * Parses a work-session reply:
 *   summary text…
 *   BOARD: IT-101 | Code Review | IT-101-json
 *   BUG: BUG-002 | Fixed: ready for retest
 *   @@ dm
 *   message to Samin…
 *   @@ sprint-1
 *   message to the channel…
 */
export function parseOutbox(text) {
  const board = [], bugs = [], messages = [], summary = [];
  let current = null;
  for (const line of text.split('\n')) {
    const at = line.match(/^@@\s*#?([\w-]+)\s*$/);
    const b = line.match(/^\s*BOARD:\s*([A-Z]+-\d+)\s*\|\s*([^|]+?)\s*(?:\|\s*(.*?))?\s*$/);
    const g = line.match(/^\s*BUG:\s*(BUG-\d+)\s*\|\s*(.+?)\s*$/);
    if (at) { current = { channel: at[1].toLowerCase(), lines: [] }; messages.push(current); }
    else if (b) board.push({ id: b[1], status: b[2], branch: b[3] && b[3] !== '-' ? b[3] : undefined });
    else if (g) bugs.push({ id: g[1], status: g[2] });
    else if (current) current.lines.push(line);
    else summary.push(line);
  }
  return {
    summary: summary.join('\n').trim(),
    board, bugs,
    messages: messages.map((m) => ({ channel: m.channel, text: m.lines.join('\n').trim() })).filter((m) => m.text),
  };
}
/** Where a teammate's "@@ dm" goes. */
export const outboxChannel = (person, name) => (name === 'dm' || name === 'samin' ? `dm-${person}` : channel(name) ? name : `dm-${person}`);

// ---------- chat replies ----------
const MENTION = /@(priya|rafi|mei|jonas|team|everyone)\b/gi;
export function mentionsIn(text) {
  const found = new Set();
  for (const [, m] of text.matchAll(MENTION)) {
    const k = m.toLowerCase();
    if (k === 'team' || k === 'everyone') TEAMMATES.forEach((t) => found.add(t));
    else found.add(k);
  }
  return [...found];
}

function chatPrompt(ch, trigger, hop, extra) {
  const c = channel(ch);
  const where = c.kind === 'dm' ? `a direct message from ${PEOPLE[trigger.from].short} to you` : `the #${c.name} channel of the team chat`;
  return [
    officeHooks.context(),
    `You're reading ${where}.`,
    `Recent messages, oldest first:`,
    transcript(ch),
    '',
    `The newest message, from ${PEOPLE[trigger.from]?.short ?? trigger.from}, is the one you're replying to:`,
    `"${trigger.text}"`,
    '',
    extra ?? '',
    `Reply as yourself, as a chat message: short and natural, the way you'd write in a team chat app. Markdown is fine.`,
    hop >= MAX_HOPS
      ? `Don't @mention other teammates in this reply. If someone else needs to weigh in, say so in words.`
      : `If you need another teammate to answer something, you may @mention them by first name (for example @Rafi) and they'll see it.`,
    `If Samin asked you to do work (start a ticket, fix a bug, review), you may do it now and say what you did.`,
  ].filter(Boolean).join('\n');
}

/** A teammate reads a message and replies in the same channel. */
export async function deliver(person, ch, trigger, { hop = 0, extra, prompt } = {}) {
  if (officeHooks.isOut(person)) {
    officeHooks.queueForTomorrow(person, ch, trigger);
    if (channel(ch).kind === 'dm' || hop === 0) append(ch, { from: 'office', text: `**${PEOPLE[person].short}** is out of office today. They'll see this when they're back.` });
    return null;
  }
  setTyping(ch, person, true);
  try {
    const reply = await runAgent(person, prompt ?? chatPrompt(ch, trigger, hop, extra));
    const { text, changes } = splitChanges(reply);
    const msg = append(ch, { from: person, text: text || '_(no reply)_', changes });
    if (hop < MAX_HOPS) {
      const next = mentionsIn(text).filter((p) => p !== person);
      await Promise.all(next.map((p) => deliver(p, ch, msg, { hop: hop + 1 })));
    }
    return msg;
  } catch (e) {
    append(ch, { from: 'office', text: `Couldn't reach ${PEOPLE[person].short}: ${e.message}` });
    return null;
  } finally {
    setTyping(ch, person, false);
  }
}
