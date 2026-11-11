# Start here

You're **Samin, QA Engineer** on a five-person team building Intent Tests. Your teammates are AI agents with
their own roles, personalities and memory, and they keep working while you're busy with something else.

## The office

Run `npm run team-chat` and open http://localhost:4321. Everything happens there:

| Where | What it's for |
|---|---|
| **Chat** | Channels (*General*, *Sprint 1*, *Bugs*, *📅 Meetings*) and a DM with each teammate. **@mention** people, or `@team` for everyone. In a channel, Priya answers posts that mention nobody. The dot on each avatar shows whether they're available, busy, in a meeting or out. |
| **Calendar** | Today's meetings and the rest of the sprint. Press **Start** to hold a meeting: everyone speaks, then it's your turn, then press **End meeting** and Priya writes down the outcome. |
| **Board** | The sprint as a kanban board. The outlined columns are yours: **Start testing**, **Pass QA**, **Reopen**. **🐞 File a bug** opens the bug form. Retest fixed bugs from the bug table. |
| **Builds** | CI. Every branch is compiled and tested on each new commit, and the result is posted in *Sprint 1*. Test only green builds. |
| **Handbook** | Everything in this folder, readable, with links that work. |

The bell in the top bar turns on desktop notifications for DMs, @mentions and your turn in meetings.

## A workday

The sprint has 10 workdays. Time only moves when you move it:

1. Press **Start day**. Read *General*. Sometimes the day starts with a surprise.
2. Go to the **standup** (Calendar). Give your update when it's your turn.
3. Work: read tickets, test what's *Ready for QA*, explore, file bugs, and answer people. Hold the meetings that are due.
4. Press **End day**. Each teammate does a day's real work (code, commits, reviews, fixes), then messages you.
   The recap lands in *General* and the [Day log](daylog.md). This takes a few minutes.

Your own work only happens when you do it, just like in a real job.

## What's where

| File | What it is |
|---|---|
| [TEAM.md](TEAM.md) | Who's who, who owns what, working agreements, **training settings** |
| [WORKFLOW.md](WORKFLOW.md) | Ceremonies, the workday, ticket and bug lifecycles, Definition of Done, severity, the bug-report rubric |
| [board.md](board.md) | The sprint board as a document (the Board view reads this file) |
| `tickets/`, `bugs/` | Stories, QA tasks and bug reports |
| `qa/` | Your own space for your strategy, charters and test files |
| [daylog.md](daylog.md), [decisions.md](decisions.md), [standups.md](standups.md) | Team history |
| `people/` | Each teammate's journal (their memory). You can read it, but it's polite not to edit it |
| `.seeded/` | The answer key for seeded defects. **Don't open it until the retro** |

## Sprint 1, step by step

1. **Day 1: Sprint planning.** Hear the estimates and risks, and say which tickets worry you as a tester.
2. **QA-1: your test strategy** in `qa/sprint-1-strategy.md`. Then DM Priya: *"Can you review my strategy?"*
3. **Refinement** for each ticket. Get the edge cases into the acceptance criteria before any code exists. Devs won't start a ticket whose criteria are still DRAFT.
4. **QA-2:** while the devs build, explore `main` and write the regression checklist. You'll probably find bugs in the existing code.
5. **Test** each ticket once it's *Ready for QA* and its build is green (the how-to is in [WORKFLOW.md](WORKFLOW.md)). File bugs, reopen or pass the ticket.
6. **Triage**: defend your severities. If a dev says "works as designed", decide whether to escalate to Priya.
7. **Sign off**: *Pass QA* tells the owner to merge. Then run the regression checklist on `main`.
8. **Day 10: review & demo, then the retro.** Give the quality summary and the go/no-go, then see which seeded defects you caught.

Real-team skills to practice here: asking questions in refinement, writing bug reports a dev can't bounce,
negotiating severity, giving status in standup, saying "no, it isn't ready", handling surprises and pressure,
and delivering bad news without blame.

**Notes**
- Every teammate reply is a real Claude run, and an end of day is one run per teammate. To make it cheaper, start the office with `TEAM_CHAT_MODEL=sonnet npm run team-chat`.
- You can also work from Claude Code: talk to teammates by name, or run `/standup`, `/triage` and so on.
- Want it harder or easier? Change the **Training settings** in [TEAM.md](TEAM.md). Want to stop role-playing for a minute? Say *"step out of the simulation"* in Claude Code.
