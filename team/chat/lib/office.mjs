// The office: a workday clock, the meeting calendar, surprises, and what happens at the end of each day.
import { DEVS, PEOPLE, TEAMMATES, append, broadcast, load, notify, readJSON, readText, writeJSON, writeText } from './store.mjs';
import { deliver, mentionsIn, outboxChannel, parseOutbox, runAgent, setOfficeHooks, splitChanges, statuses, transcript } from './agents.mjs';
import { readBoard, setBugStatus, setTicketStatus, logActivity } from './board.mjs';

const STATE = 'team/office.json';
const SPRINT_START = new Date('2026-11-11T09:00:00');
const DEFAULT = { sprint: 1, day: 1, daysInSprint: 10, phase: 'before', usedEvents: [], today: { event: null, out: [], done: [] }, pending: [], meeting: null };
let state = { ...DEFAULT, ...readJSON(STATE, {}) };
const save = () => { writeJSON(STATE, state); broadcast({ type: 'office', office: view() }); };

// ---------- time ----------
function dateOfDay(day) { // workdays only
  const d = new Date(SPRINT_START);
  let n = 1;
  while (n < day) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n++; }
  return d;
}
const fmtDate = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const dayLabel = () => `Day ${state.day}`;
const surprisesOn = () => !/Surprises:\s*OFF/i.test(readText('team/TEAM.md'));
const isOut = (p) => state.phase !== 'before' && state.today.out.includes(p);

export function context() {
  const parts = [`Office: Sprint ${state.sprint}, Day ${state.day} of ${state.daysInSprint} (${fmtDate(dateOfDay(state.day))}).`];
  if (state.phase === 'before') parts.push('The workday has not started yet.');
  const out = state.today.out.filter(() => state.phase !== 'before');
  if (out.length) parts.push(`Out of office today: ${out.map((p) => PEOPLE[p].short).join(', ')}.`);
  if (state.meeting) parts.push(`Meeting in progress: ${state.meeting.title}.`);
  return parts.join(' ');
}

// ---------- calendar ----------
const MEETING_TITLES = { standup: 'Daily standup', planning: 'Sprint planning', refinement: 'Backlog refinement', triage: 'Bug triage', oneonone: '1:1 with Priya', demo: 'Sprint review & demo', retro: 'Retrospective' };
function scheduleFor(day) {
  const s = [];
  if (day === 1) s.push({ type: 'planning', time: '10:00' });
  else s.push({ type: 'standup', time: '09:30' });
  if (day === 1 || day === 2 || day === 5) s.push({ type: 'refinement', time: day === 1 ? '14:00' : '11:00', note: 'Pick a ticket whose acceptance criteria are still DRAFT' });
  if ([3, 6, 8].includes(day)) s.push({ type: 'triage', time: '14:00' });
  if (day === 4 || day === 9) s.push({ type: 'oneonone', time: '16:00' });
  if (day === 10) s.push({ type: 'demo', time: '14:00' }, { type: 'retro', time: '15:30' });
  return s.map((m) => ({ ...m, title: MEETING_TITLES[m.type] }));
}

export function view() {
  const today = scheduleFor(state.day).map((m) => ({ ...m, done: state.today.done.includes(m.type) }));
  const upcoming = [];
  for (let d = state.day + 1; d <= state.daysInSprint; d++) upcoming.push({ day: d, date: fmtDate(dateOfDay(d)), meetings: scheduleFor(d) });
  return {
    sprint: state.sprint, day: state.day, daysInSprint: state.daysInSprint, date: fmtDate(dateOfDay(state.day)), phase: state.phase,
    out: state.phase === 'before' ? [] : state.today.out, event: state.today.event, meeting: state.meeting, today, upcoming,
    surprises: surprisesOn(), statuses: statuses(), titles: MEETING_TITLES,
  };
}

// ---------- surprises ----------
// Each one is a realistic situation a QA engineer meets on a real team. The teammate playing it decides the details.
const EVENTS = [
  { id: 'user-report', minDay: 2, actor: 'priya', channel: 'general', title: 'A user reported a problem',
    prompt: `Speaking as PO: a user wrote in our feedback channel that "the behavior counts above my functions disappeared after I changed a setting". You don't know whether it's real, a misunderstanding, or a settings issue. Ask Samin to investigate it: reproduce it or rule it out, and come back with evidence. It isn't planned sprint work, so ask Samin to say what it pushes back.` },
  { id: 'sick', minDay: 2, actor: 'priya', channel: 'general', out: 'mei', title: 'Mei is out sick',
    prompt: `Mei messaged you early this morning: they're sick and out today. Tell the team in a short message, and ask Samin to think about what this does to testing on Mei's tickets this sprint.` },
  { id: 'pairing', minDay: 2, actor: 'jonas', channel: 'dm', title: 'Jonas wants to pair',
    prompt: `Message Samin directly: before you go further on your next ticket, you'd like to pair with them for 30 minutes on how they'd test it, because you want to get it right this time. Ask when suits them and what you should prepare.` },
  { id: 'scope-change', minDay: 3, actor: 'priya', channel: 'sprint-1', title: 'Scope change mid-sprint',
    prompt: `Speaking as PO: a stakeholder asked for a small extra story this sprint: "intent-tests check reports a clear, specific error when the plan file is missing". Create the ticket file in team/tickets/ with the next story ID from team/board.md (owner Rafi, 2 points, acceptance criteria marked DRAFT), add it to the board as Backlog, and bump "Next story". Then announce it in this message, ask the team what should come out of the sprint to make room, and ask Samin what it does to the test plan.` },
  { id: 'quick-look', minDay: 3, actor: 'jonas', channel: 'dm', title: 'An informal request',
    prompt: `Message Samin directly. You're a bit behind and stressed. Ask whether they could "just take a quick look" at your branch before it's officially Ready for QA, informally, without writing anything up, so you can move faster. Be genuine and friendly. Don't hint that this is a test of process.` },
  { id: 'skip-qa', minDay: 4, actor: 'rafi', channel: 'sprint-1', title: 'A dev wants to skip QA',
    prompt: `Post in the Sprint 1 channel: you think IT-102 is so small that it doesn't need QA, and you'd like to merge it straight after code review to save time. Sound pragmatic and reasonable, not hostile. If IT-102 is already Done, make the same argument about the smallest ticket you own that isn't Done.` },
  { id: 'status-report', minDay: 4, actor: 'priya', channel: 'dm', title: 'Your manager wants a status',
    prompt: `Message Samin directly: your own manager asked you for a short quality status of the sprint by the end of today. Ask Samin to draft one paragraph for you: what's tested, what's at risk, and what they'd flag. Say you'll give feedback on it.` },
  { id: 'demo-early', minDay: 5, actor: 'priya', channel: 'general', title: 'The demo moved earlier',
    prompt: `Speaking as PO: stakeholders want a preview of the sprint at the end of tomorrow, earlier than planned. Ask Samin which tickets can be shown with confidence, which can't, and what the known risks are. Keep it calm. This happens.` },
  { id: 'late-handoff', minDay: 7, actor: 'rafi', channel: 'dm', title: 'A late hand-off',
    prompt: `Message Samin directly: the sprint is nearly over. Ask whether they could start testing your current ticket today even though you're still finishing a couple of things, because otherwise it won't make the sprint. Be honest about what's not finished.` },
];

// ---------- the day ----------
export async function startDay() {
  if (state.phase !== 'before') throw new Error('The day has already started.');
  if (state.day > state.daysInSprint) throw new Error('The sprint is over.');
  state.phase = 'working';
  let event = null;
  if (surprisesOn() && state.day >= 2 && Math.random() < 0.45) {
    const options = EVENTS.filter((e) => e.minDay <= state.day && !state.usedEvents.includes(e.id));
    event = options[Math.floor(Math.random() * options.length)] ?? null;
  }
  state.today = { event: event ? { id: event.id, title: event.title } : null, out: event?.out ? [event.out] : [], done: [] };
  if (event) state.usedEvents.push(event.id);
  const meetings = scheduleFor(state.day).map((m) => `${m.time} ${m.title}`).join(' · ');
  save();
  notify('general', `☀️ **Day ${state.day} of Sprint ${state.sprint}** has started (${fmtDate(dateOfDay(state.day))}).\n\nToday: ${meetings}. The meetings are on the **Calendar**.${state.today.out.length ? `\n\n🤒 Out of office today: ${state.today.out.map((p) => PEOPLE[p].short).join(', ')}.` : ''}`);

  // Messages that arrived while someone was out reach them now.
  const back = state.pending.filter((p) => !state.today.out.includes(p.person));
  state.pending = state.pending.filter((p) => state.today.out.includes(p.person));
  save();
  for (const p of back) deliver(p.person, p.channel, p.trigger, { extra: 'You were out of office when this arrived. You are back today.' });

  if (event) {
    const ch = event.channel === 'dm' ? `dm-${event.actor}` : event.channel;
    const trigger = { from: 'office', text: `(${event.title})` };
    deliver(event.actor, ch, trigger, {
      prompt: [context(), `Something is happening at work this morning. ${event.prompt}`, '', `Write it as a chat message from you (markdown is fine). Don't mention that this is a scenario or a test.`].join('\n'),
    });
  }
  return view();
}

function workPrompt(person) {
  const isLead = person === 'priya';
  const recent = [
    `Direct messages with Samin:\n${transcript(`dm-${person}`, { limit: 10 })}`,
    `#Sprint 1:\n${transcript('sprint-1', { limit: 10 })}`,
    `#Bugs:\n${transcript('bugs', { limit: 6 })}`,
    `#General:\n${transcript('general', { limit: 6 })}`,
  ].join('\n\n');
  return [
    context(),
    `It's the end of Day ${state.day}. This is your work session for the rest of today.`,
    isLead
      ? `Do what a QA lead would get done this afternoon: look at what changed today (team/board.md, team/bugs/, team/qa/, the chat below), coach Samin according to the Coaching setting, keep the board honest, and prepare tomorrow: who's blocked, and what needs a decision.`
      : `Do the amount of real work you'd realistically get done in one working day, and no more: a 2–3 point ticket usually takes one or two days, and a 5 pointer takes three or four. Start or continue your tickets in your worktree, commit on your branch, run the build and tests, do code reviews you were asked for, and fix bugs assigned to you. Follow every team rule, including the Definition of Ready. If something you need isn't ready, say so instead of working around it.`,
    `Keep the promises in your journal, and answer anything below that's waiting for you.`,
    '',
    `Recent chat:\n${recent}`,
    '',
    `Rules for this session:`,
    `- Don't edit team/board.md in this session: other people are working at the same time. Report every status change on a line of its own instead, and the office will apply it:`,
    `  BOARD: <ticket> | <new status> | <branch, or ->`,
    `  BUG: <bug ID> | <new status>`,
    `  Ticket statuses: Backlog, Ready, In Progress, Code Review, Ready for QA, In QA, QA Passed, Reopened, Done.`,
    `- You can still edit tickets, bugs, your journal and code as usual.`,
    `- To send messages, put each one under a line of its own like "@@ dm" (a direct message to Samin), "@@ sprint-1", "@@ bugs" or "@@ general". Send only what a real colleague would. Often that's one message or none.`,
    '',
    `Start your reply with one or two sentences summarizing your day, for the team's day log. Then the BOARD/BUG lines, then your messages. End with the usual --- and **Changes:** list.`,
  ].join('\n');
}

/** Throws if the day can't end now. Called before anything starts, so the request fails right away. */
export function checkEndDay() {
  if (state.phase !== 'working') throw new Error(state.phase === 'ending' ? 'The day is already ending.' : state.phase === 'done' ? 'The sprint is over.' : 'Start the day first.');
  if (state.meeting) throw new Error(`End the ${state.meeting.title} first.`);
}

export async function endDay() {
  checkEndDay();
  state.phase = 'ending'; save();
  notify('general', `🌙 **End of Day ${state.day}.** Everyone's finishing their work for the day. Updates will appear as they come in.`);

  const people = TEAMMATES.filter((p) => !isOut(p));
  const results = await Promise.all(people.map(async (p) => {
    try { return { person: p, ...splitChanges(await runAgent(p, workPrompt(p), { timeoutMs: 25 * 60e3 })) }; }
    catch (e) { return { person: p, error: e.message }; }
  }));

  const log = [`## Day ${state.day} (${fmtDate(dateOfDay(state.day))})`, ''];
  for (const r of results) {
    if (r.error) { log.push(`- **${PEOPLE[r.person].short}:** _(couldn't finish: ${r.error})_`); continue; }
    const out = parseOutbox(r.text);
    for (const b of out.board) {
      try {
        const { old, status } = setTicketStatus(b.id, b.status, { branch: b.branch });
        if (old !== status) { logActivity(b.id, `${PEOPLE[r.person].short} moved it from ${old} to ${status}.`, dayLabel()); notify('sprint-1', `📋 **${PEOPLE[r.person].short}** moved **${b.id}** from ${old} to **${status}**.`); }
      } catch (e) { notify('sprint-1', `⚠️ Couldn't apply ${PEOPLE[r.person].short}'s board change for ${b.id}: ${e.message}`); }
    }
    for (const g of out.bugs) {
      try {
        const { old, status } = setBugStatus(g.id, g.status);
        if (old !== status) { logActivity(g.id, `${PEOPLE[r.person].short} set the status to ${status}.`, dayLabel()); notify('bugs', `🐞 **${PEOPLE[r.person].short}** set **${g.id}** to **${status}**.`); }
      } catch (e) { notify('bugs', `⚠️ Couldn't apply ${PEOPLE[r.person].short}'s change for ${g.id}: ${e.message}`); }
    }
    for (const m of out.messages) append(outboxChannel(r.person, m.channel), { from: r.person, text: m.text, changes: r.changes });
    log.push(`- **${PEOPLE[r.person].short}:** ${out.summary.split('\n')[0] || '_(no summary)_'}`);
  }
  for (const p of TEAMMATES.filter(isOut)) log.push(`- **${PEOPLE[p].short}:** out of office.`);
  const daylog = readText('team/daylog.md') || '# Day log\n\nWhat each person got done, day by day. Newest first.\n';
  writeText('team/daylog.md', daylog.replace(/(Newest first\.\n)/, `$1\n${log.join('\n')}\n`));
  notify('general', `📒 **Day ${state.day} recap**\n\n${log.slice(2).join('\n')}\n\nThe full log is in the Handbook (Team history → Day log).`);

  if (state.day >= state.daysInSprint) { state.phase = 'done'; notify('general', `🏁 **Sprint ${state.sprint} is over.** If you haven't yet, run the review & demo and the retrospective from the Calendar.`); }
  else { state.day += 1; state.phase = 'before'; }
  state.today = { event: null, out: [], done: state.phase === 'done' ? state.today.done : [] };
  save();
  return view();
}

// ---------- meetings ----------
const header = (m) => `You're in the "${m.title}" meeting in the #Meetings channel.${m.ticket ? ` It's about ${m.ticket}.` : ''} Meeting transcript so far:\n${transcript('meetings', { since: m.startedAt, limit: 40 })}\n`;
const PLAN = {
  standup: () => ({
    rounds: [[...TEAMMATES]],
    open: () => `Give your standup update in 3 short lines (Yesterday / Today / Blockers), based on the board and your journal. Name anyone you're blocked on. Don't start new work during the meeting.`,
    turn: 'Your update: what you did yesterday, what you will do today, and anything blocking you.',
    respond: ['priya'],
    wrap: `The standup is over. Add the whole standup (everyone's update, including Samin's, and any follow-ups agreed) to the top of team/standups.md under a heading for today. Then post a 2–3 line closing message listing the follow-ups.`,
  }),
  planning: () => ({
    rounds: [['priya'], [...DEVS]],
    open: (p) => (p === 'priya'
      ? `Open sprint planning: restate the sprint goal as PO, propose an order for the tickets, and ask the devs for their estimates and risks.`
      : `Read your own tickets. Say whether you agree with the estimate, and name one risk or dependency.`),
    turn: 'Which tickets look hardest to test, and why? How much test effort do you expect? Should anything be cut?',
    respond: ['priya'],
    wrap: `Planning is over. As PO, commit the sprint scope taking Samin's input into account. Record the committed scope and any cuts in team/decisions.md, set the sprint's Status line in team/board.md to "In progress", and post the commitment. Remind everyone that tickets need refinement before work starts.`,
  }),
  refinement: (m) => {
    const owner = readBoard().tickets.find((t) => t.id === m.ticket)?.ownerKey ?? 'rafi';
    return {
      rounds: [[owner], ['priya']],
      open: (p) => (p === owner
        ? `We're refining ${m.ticket}. Read the ticket and the relevant code. Say briefly how you'd build it, and list your questions.`
        : `As PO, add anything about the scope of ${m.ticket} the team should know. Don't write acceptance criteria yet.`),
      turn: `What questions and edge cases do you want written into the acceptance criteria for ${m.ticket}? This is the cheapest moment to find bugs.`,
      respond: [...new Set(['priya', owner])],
      wrap: `Refinement of ${m.ticket} is over. Write the final acceptance criteria into the ticket in Given / When / Then form, covering everything agreed in the meeting. Remove "DRAFT", list anything deliberately out of scope, and set ${m.ticket} to Ready in team/board.md. Post a short summary of the final criteria.`,
    };
  },
  triage: () => ({
    rounds: [['priya'], 'owners'],
    open: (p) => (p === 'priya'
      ? `Triage every bug in team/bugs/ whose status is New: confirm or change the severity with a reason, set the priority as PO, assign an owner from the ownership table, and update the bug file and the Bugs table in team/board.md (set the status to Triaged). Give Samin brief feedback on report quality against the rubric. If there are no new bugs, say so and keep it short.`
      : `Read the bugs assigned to you in this triage and respond in character, following your pushback setting. Try to reproduce them if that helps. Don't fix anything during the meeting.`),
    turn: 'Do you agree with the triage? If a dev disputed one of your bugs, defend it with evidence, or accept their reasoning.',
    respond: ['priya'],
    wrap: `Triage is over. Decide any disputes, record them in team/decisions.md, and post the final outcome for each bug.`,
  }),
  oneonone: () => ({
    rounds: [['priya']],
    open: () => `This is your weekly 1:1 with Samin. First look at what Samin has done so far (team/qa/, bugs they filed, tickets they tested, how they handled pushback in the chat history files under team/chat/history/). Ask how it's going, give specific feedback (one strength and one growth area, with examples), and ask one question.`,
    turn: "Talk to Priya: how it's going, what's hard, and what you want to learn.",
    respond: ['priya'],
    wrap: `The 1:1 is over. Summarize the growth goals you agreed in 2–3 lines and note them in your journal.`,
  }),
  demo: () => ({
    rounds: [[...DEVS]],
    open: () => `Sprint review. Give a 3–5 line demo of your tickets that are Done or nearly done: what a user can do now and how to try it. Be honest about anything that isn't finished.`,
    turn: "Give the quality summary: what was tested, the open bugs and their risk, the regression checklist result, and whether you'd ship.",
    respond: ['priya'],
    wrap: `The review is over. Give feedback on Samin's quality summary and make the go/no-go decision as PO. Record it in team/decisions.md.`,
  }),
  retro: () => ({
    rounds: [[...TEAMMATES]],
    open: () => `Retrospective. Give 2 things that went well, 2 that didn't, and 1 suggestion, based on your journal and the sprint's tickets, bugs and decisions. Be honest, including about working with QA. (Priya: don't reveal the seeded defects yet.)`,
    turn: "Your retro: what went well, what didn't, and one suggestion.",
    respond: ['priya'],
    wrap: `Now reveal the seeded defects: read team/.seeded/, match each one to a filed bug if there is one, and give Samin a table: Defect | Caught? | Bug | Technique that finds it. Then give a short, kind and specific coaching summary. Agree 2–3 action items for the next sprint and write them in team/decisions.md.`,
  }),
};

async function speak(person, m, instruction) {
  return deliver(person, 'meetings', { from: 'office', text: `(${m.title})` }, {
    prompt: [context(), header(m), instruction, '', `Reply as yourself, in the meeting, as a chat message. Keep it brief, like speaking in a real meeting. Don't @mention people.`].join('\n'),
  });
}

/** Throws if this meeting can't start now. After the sprint ends, only the review and the retro can still be held. */
export function checkMeeting(type, { ticket } = {}) {
  if (!PLAN[type]) throw new Error(`Unknown meeting: ${type}`);
  if (state.meeting) throw new Error(`The ${state.meeting.title} is still going. End it first.`);
  if (state.phase === 'before') throw new Error(`Day ${state.day} hasn't started. Press "Start day" first.`);
  if (state.phase === 'ending') throw new Error('The day is ending.');
  if (state.phase === 'done' && !['demo', 'retro'].includes(type)) throw new Error('The sprint is over. Only the review and the retro are left.');
  if (type === 'refinement' && !readBoard().tickets.some((t) => t.id === ticket)) throw new Error('Pick a ticket to refine.');
}

export async function startMeeting(type, { ticket } = {}) {
  checkMeeting(type, { ticket });
  const m = { type, title: MEETING_TITLES[type] + (ticket ? `: ${ticket}` : ''), ticket, startedAt: new Date().toISOString(), phase: 'opening' };
  state.meeting = m; save();
  notify('meetings', `📅 **${m.title}** has started.`);
  const plan = PLAN[type](m);
  const bugsBefore = readBoard().bugs.filter((b) => /^new$/i.test(b.status)).map((b) => b.id);
  for (const round of plan.rounds) {
    let who = round;
    if (round === 'owners') who = [...new Set(readBoard().bugs.filter((b) => bugsBefore.includes(b.id) && b.ownerKey && b.ownerKey !== 'priya').map((b) => b.ownerKey))];
    const present = who.filter((p) => !isOut(p));
    who.filter(isOut).forEach((p) => notify('meetings', `${PEOPLE[p].short} is out of office and can't join.`));
    await Promise.all(present.map((p) => speak(p, m, plan.open(p))));
  }
  state.meeting = { ...m, phase: 'open', respond: plan.respond, turn: plan.turn }; save();
  notify('meetings', `🎤 **Your turn, Samin.** ${plan.turn}\n\nWhen you're done, press **End meeting**.`);
  return view();
}

/** Samin said something in the meeting. */
export function meetingMessage(msg) {
  const m = state.meeting;
  if (!m || m.phase !== 'open') return false;
  const named = mentionsIn(msg.text);
  const who = [...new Set([...(named.length ? named : m.respond)])].filter((p) => !isOut(p));
  for (const p of who) speak(p, m, `Samin just said: "${msg.text}"\nRespond to it as part of the meeting.`);
  return true;
}

export function checkEndMeeting() {
  const m = state.meeting;
  if (!m) throw new Error('No meeting is running.');
  if (m.phase === 'opening') throw new Error('Wait until everyone has spoken.');
  if (m.phase === 'wrapping') throw new Error('The meeting is already wrapping up.');
}

export async function endMeeting() {
  checkEndMeeting();
  const m = state.meeting;
  state.meeting = { ...m, phase: 'wrapping' }; save();
  const plan = PLAN[m.type](m);
  await speak('priya', m, plan.wrap);
  if (!state.today.done.includes(m.type)) state.today.done.push(m.type);
  state.meeting = null; save();
  notify('meetings', `✅ **${m.title}** has ended.`);
  return view();
}

// ---------- wiring ----------
setOfficeHooks({
  isOut,
  inMeeting: () => Boolean(state.meeting),
  context,
  queueForTomorrow: (person, ch, trigger) => { state.pending.push({ person, channel: ch, trigger }); save(); },
});
// A restart in the middle of something leaves a usable state.
if (state.phase === 'ending') state.phase = 'working';
if (state.meeting && state.meeting.phase !== 'open') state.meeting = { ...state.meeting, phase: 'open', respond: ['priya'], turn: 'Carry on.' };
save();
export const officeView = view;
