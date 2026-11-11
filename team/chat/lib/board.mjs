// Reads and updates team/board.md (the source of truth for status), ticket activity logs and bug files.
import fs from 'node:fs';
import { byName, readText, teamPath, writeText } from './store.mjs';

const BOARD = 'team/board.md';
export const STATUSES = ['Backlog', 'Ready', 'In Progress', 'Code Review', 'Ready for QA', 'In QA', 'QA Passed', 'Reopened', 'Done'];
export const BUG_STATUSES = ['New', 'Triaged', 'In Progress', 'Fixed: ready for retest', 'Reopened', 'Closed', "Won't fix"];

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const row = (values) => `| ${values.join(' | ')} |`;
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
const plainId = (cell) => (cell.match(/[A-Z]+-\d+/) ?? [''])[0];

/** Finds the table whose header row starts with ID and has the given column (Type = tickets, Severity = bugs). */
function findTable(lines, column) {
  const h = lines.findIndex((l, i) => isRow(l) && cells(l)[0] === 'ID' && cells(l).includes(column) && isSep(lines[i + 1] ?? ''));
  if (h < 0) return null;
  const header = cells(lines[h]);
  let end = h + 2;
  while (end < lines.length && isRow(lines[end])) end++;
  const rows = [];
  for (let i = h + 2; i < end; i++) {
    const c = cells(lines[i]);
    rows.push({ line: i, cells: c, get: (name) => c[header.indexOf(name)] ?? '' });
  }
  return { header, headerLine: h, end, rows };
}

export function readBoard() {
  const text = readText(BOARD);
  const lines = text.split('\n');
  const t = findTable(lines, 'Type'), b = findTable(lines, 'Severity');
  const tickets = (t?.rows ?? []).map((r) => ({
    id: plainId(r.get('ID')), title: r.get('Title'), type: r.get('Type'), owner: r.get('Owner'), ownerKey: byName(r.get('Owner')),
    points: r.get('Pts'), status: r.get('Status'), branch: r.get('Branch'), bugs: r.get('Bugs'),
  }));
  const bugs = (b?.rows ?? []).map((r) => ({
    id: plainId(r.get('ID')), title: r.get('Title'), severity: r.get('Severity'), priority: r.get('Priority'),
    ticket: plainId(r.get('Ticket')), owner: r.get('Owner'), ownerKey: byName(r.get('Owner')), status: r.get('Status'),
  }));
  const goal = (text.match(/\*\*Sprint goal:\*\*\s*(.+)/) ?? [])[1] ?? '';
  return { goal, tickets, bugs, statuses: STATUSES, bugStatuses: BUG_STATUSES };
}

/** Changes one cell of a ticket row (table 1) or bug row (table 2). Returns the old value. */
function setCell(which, id, column, value) {
  const lines = readText(BOARD).split('\n');
  const table = findTable(lines, which === 'ticket' ? 'Type' : 'Severity');
  if (!table) throw new Error(`No ${which} table on the board.`);
  const r = table.rows.find((x) => plainId(x.cells[0]) === id);
  if (!r) throw new Error(`${id} isn't on the board.`);
  const col = table.header.indexOf(column);
  const old = r.cells[col];
  const updated = [...r.cells]; updated[col] = value;
  lines[r.line] = row(updated);
  writeText(BOARD, lines.join('\n'));
  return old;
}

export function setTicketStatus(id, status, { branch } = {}) {
  const canonical = STATUSES.find((s) => s.toLowerCase() === status.toLowerCase()) ?? status;
  const old = setCell('ticket', id, 'Status', canonical);
  if (branch) setCell('ticket', id, 'Branch', branch);
  return { old, status: canonical };
}
export function setBugStatus(id, status) {
  const canonical = BUG_STATUSES.find((s) => s.toLowerCase() === status.toLowerCase()) ?? status;
  return { old: setCell('bug', id, 'Status', canonical), status: canonical };
}
export function linkBugToTicket(ticket, bugId) {
  const t = readBoard().tickets.find((x) => x.id === ticket);
  if (!t) return;
  setCell('ticket', ticket, 'Bugs', t.bugs ? `${t.bugs}, ${bugId}` : bugId);
}

/** Adds a dated line to the "## Activity" section at the end of a ticket or bug file. */
export function logActivity(id, text, dayLabel) {
  const rel = fs.existsSync(teamPath(`team/tickets/${id}.md`)) ? `team/tickets/${id}.md` : `team/bugs/${id}.md`;
  if (!fs.existsSync(teamPath(rel))) return;
  let body = readText(rel).replace(/\s*$/, '');
  if (!/^## Activity/m.test(body)) body += '\n\n## Activity';
  body = body.replace(/\n-\s*$/, ''); // drop the template's empty bullet
  writeText(rel, `${body}\n- ${new Date().toISOString().slice(0, 10)} (${dayLabel}): ${text}\n`);
}

// ---------- bugs ----------
function nextBugId() {
  const m = readText(BOARD).match(/Next bug:\s*BUG-(\d+)/);
  return m ? Number(m[1]) : 1;
}
const pad = (n) => String(n).padStart(3, '0');
const cellSafe = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

export function createBug(f, dayLabel) {
  const n = nextBugId(), id = `BUG-${pad(n)}`;
  const block = (s) => String(s ?? '').trim() || '_(not given)_';
  const fenced = (s) => (String(s ?? '').trim() ? '```\n' + String(s).trim().replace(/```/g, "'''") + '\n```' : '_(not given)_');
  const steps = String(f.steps ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => (/^\d+[.)]/.test(l) ? l : `${i + 1}. ${l}`)).join('\n') || '1. _(not given)_';
  writeText(`team/bugs/${id}.md`, `# ${id}: ${cellSafe(f.title)}

**Reported by:** Samin · **Date:** ${new Date().toISOString().slice(0, 10)} (${dayLabel}) · **Ticket:** ${f.ticket || 'existing feature'}
**Proposed severity:** ${f.severity} because ${cellSafe(f.severityReason) || '_(no reason given)_'}
**Priority:** _(set by Priya at triage)_ · **Owner:** _(assigned at triage)_ · **Status:** New

## Environment
- Branch / commit: ${cellSafe(f.branch) || '_(not given)_'}
- OS: ${cellSafe(f.os) || 'Windows 11'}
- VS Code version (editor bugs only): ${cellSafe(f.vscode) || 'n/a'}

## Steps to reproduce
${steps}

## Expected result
${block(f.expected)}

## Actual result
${fenced(f.actual)}

## Evidence
${block(f.evidence)}

## Notes
${block(f.notes)}

## Activity
- ${new Date().toISOString().slice(0, 10)} (${dayLabel}): Filed by Samin.
`);

  // Board: add the row, link it from the ticket, and bump the next ID.
  const lines = readText(BOARD).split('\n');
  const bugsTable = findTable(lines, 'Severity');
  const newRow = row([`[${id}](bugs/${id}.md)`, cellSafe(f.title), cellSafe(f.severity) + ' (proposed)', '—', f.ticket || '—', '—', 'New']);
  if (bugsTable) lines.splice(bugsTable.end, 0, newRow);
  else lines.push('', '## Bugs', '', row(['ID', 'Title', 'Severity', 'Priority', 'Ticket', 'Owner', 'Status']), '|---|---|---|---|---|---|---|', newRow);
  writeText(BOARD, lines.join('\n').replace(/Next bug:\s*BUG-\d+/, `Next bug: BUG-${pad(n + 1)}`));
  if (f.ticket) linkBugToTicket(f.ticket, id);
  return id;
}
