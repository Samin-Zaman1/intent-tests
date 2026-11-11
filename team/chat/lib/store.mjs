// Shared state for the office server: people, channels, message history and live updates.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(HERE, '..', '..');
export const HISTORY = path.join(HERE, 'history');
fs.mkdirSync(HISTORY, { recursive: true });

export const PEOPLE = {
  samin: { name: 'Samin Zaman', short: 'Samin', role: 'QA Engineer', color: '#0f766e' },
  priya: { name: 'Priya Nair', short: 'Priya', role: 'QA Lead', agent: 'qa-lead', color: '#7c3aed' },
  rafi: { name: 'Rafi Haddad', short: 'Rafi', role: 'Backend Developer', agent: 'be-dev', color: '#c2410c' },
  mei: { name: 'Mei Lin', short: 'Mei', role: 'Frontend Developer (editor)', agent: 'fe-dev-editor', color: '#2563eb' },
  jonas: { name: 'Jonas Berg', short: 'Jonas', role: 'Frontend Developer (reports)', agent: 'fe-dev-reports', color: '#be185d' },
  ci: { name: 'CI', short: 'CI', role: 'Build pipeline', color: '#475569', bot: true },
  office: { name: 'Office', short: 'Office', role: 'Notifications', color: '#64748b', bot: true },
};
export const TEAMMATES = ['priya', 'rafi', 'mei', 'jonas'];
export const DEVS = ['rafi', 'mei', 'jonas'];
/** Board "Owner" cell → person key. */
export const byName = (name) => Object.keys(PEOPLE).find((k) => PEOPLE[k].short.toLowerCase() === String(name).trim().toLowerCase());

export const CHANNELS = [
  { id: 'general', kind: 'channel', name: 'General', topic: 'Team-wide chat. @mention people, or @team for everyone.' },
  { id: 'sprint-1', kind: 'channel', name: 'Sprint 1', topic: 'Sprint work, board updates and CI results.' },
  { id: 'bugs', kind: 'channel', name: 'Bugs', topic: 'Bug reports and triage.' },
  { id: 'meetings', kind: 'channel', name: 'Meetings', topic: 'Where meetings happen. Start one from the Calendar.' },
  ...TEAMMATES.map((id) => ({ id: `dm-${id}`, kind: 'dm', person: id, name: PEOPLE[id].name, topic: PEOPLE[id].role })),
];
export const channel = (id) => CHANNELS.find((c) => c.id === id);

// ---------- live updates (server-sent events) ----------
export const clients = new Set();
export function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(data);
}

// ---------- message history ----------
const file = (ch) => path.join(HISTORY, `${ch}.jsonl`);
export function load(ch) {
  if (!fs.existsSync(file(ch))) return [];
  return fs.readFileSync(file(ch), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
export function append(ch, msg) {
  const full = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: new Date().toISOString(), channel: ch, ...msg };
  fs.appendFileSync(file(ch), JSON.stringify(full) + '\n');
  broadcast({ type: 'message', message: full });
  return full;
}
export const notify = (ch, text, from = 'office') => append(ch, { from, text });

// ---------- team files ----------
export const teamPath = (rel) => path.join(REPO, ...rel.split('/'));
export const readText = (rel) => (fs.existsSync(teamPath(rel)) ? fs.readFileSync(teamPath(rel), 'utf8') : '');
export const writeText = (rel, text) => { fs.mkdirSync(path.dirname(teamPath(rel)), { recursive: true }); fs.writeFileSync(teamPath(rel), text); };
export const readJSON = (rel, fallback) => { try { return JSON.parse(readText(rel)); } catch { return fallback; } };
export const writeJSON = (rel, value) => writeText(rel, JSON.stringify(value, null, 2) + '\n');
