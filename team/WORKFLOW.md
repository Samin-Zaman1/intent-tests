# How we work

Two-week sprints (10 workdays) with Scrum-style ceremonies. They're on the **Calendar** in the Team Office app,
and each one also has a slash command for Claude Code:

| Ceremony | When | Command | What happens | Your job as QA |
|---|---|---|---|---|
| Sprint planning | Day 1 | `/sprint-planning` | Team picks tickets from the backlog, estimates and commits | Flag tickets that are hard to test, and estimate your test effort too |
| Refinement ("three amigos") | Days 1, 2, 5, or any time | `/refinement IT-101` | Dev + QA + PO agree acceptance criteria for one ticket | Ask "what happens when…?" until the edge cases are written down |
| Daily standup | Days 2–10, 09:30 | `/standup` | Yesterday / today / blockers, about 2 minutes each | Report what you tested, what's blocked, and which bugs are open |
| Bug triage | Days 3, 6, 8 | `/triage` | Priya sets severity and priority on new bugs and assigns them | Defend your severity with evidence |
| 1:1 with Priya | Days 4, 9 | (app only) | Your lead's feedback on how you're doing | Ask for what you want to learn |
| Sprint review / demo | Day 10 | `/demo` | Devs show what's done, and QA says what was tested and what's known to be broken | Give the quality summary |
| Retrospective | Day 10 | `/retro` | What went well, what didn't, what we change. Seeded defects get revealed | Be honest about what you missed |

Between ceremonies, talk to anyone directly: *"Ask Rafi why `check` exits 1 here"*, *"Tell Mei BUG-003 is reopened"*.

## A workday

1. **Start day.** The day begins. Sometimes something unplanned happens (see *Surprises* in [TEAM.md](TEAM.md)).
2. **Standup**, then your own work: testing, exploring, writing bug reports, and talking to people.
3. **Meetings** from the calendar, when they're due.
4. **End day.** Everyone does the rest of their day's work on their own. Devs write code, commit, review each
   other and fix bugs. Priya reviews the day. Then they message you, and the day's recap goes to General
   and to the [Day log](daylog.md). Work you haven't done doesn't do itself.

## Ticket lifecycle

```
Backlog → Ready → In Progress → Code Review → Ready for QA → In QA → QA Passed → Done
                                                   ↑            │
                                                   └─ Reopened ←┘  (QA found a blocking bug)
```

- **Backlog → Ready**: refinement is done, the acceptance criteria are written, and QA has read them (Definition of Ready).
- **In Progress**: the dev creates the branch `<ticket>-<slug>` in `.worktrees/<ticket>/`.
- **Code Review**: another dev reviews. A dev can't review their own ticket.
- **Ready for QA**: the build compiles, all tests pass, the dev has written test notes on the ticket, and the
  dev has told QA.
- **In QA**: you're testing. Record what you tested in the ticket's *QA notes*. Only test a branch whose CI build is green.
- **QA Passed**: you signed it off. The owner merges it.
- **Reopened**: a bug that blocks the acceptance criteria goes back to the dev, linked to the ticket.
- **Done**: the dev merged to `main` after QA Passed. Bugs that don't block can stay open as separate tickets.

QA moves the outlined columns on the Board (*Start testing*, *Pass QA*, *Reopen*). Devs move everything else.

## Bug lifecycle

`New → Triaged → In Progress → Fixed: ready for retest → Closed` (or back to `Reopened` if your retest fails).
Only QA closes a bug, and only after retesting it. File bugs with **🐞 File a bug** on the Board.

## Definition of Done

- [ ] Every acceptance criterion is verified by QA, with evidence written in the ticket
- [ ] Unit tests added for new behavior, and the whole suite passes (`npm test`)
- [ ] `npm run compile` is clean
- [ ] No open Sev-1 or Sev-2 bugs against the ticket
- [ ] The regression checklist ([templates/regression-checklist.md](templates/regression-checklist.md)) has been run on the merged build

## Bug severity and priority

**Severity** is how bad the bug is for the user. QA proposes it and Priya confirms it.
**Priority** is how soon we fix it. Priya decides, as PO.

| Severity | Meaning | Example in this product |
|---|---|---|
| **Sev-1 Critical** | Crash, data loss, or the feature can't be used at all | The extension fails to activate; `check` exits 0 when the plan is not met (CI passes broken code) |
| **Sev-2 Major** | A main flow is wrong and there's no reasonable workaround | Wrong behavior count; JSON output that isn't valid JSON |
| **Sev-3 Minor** | Wrong but there's a workaround, or it's an edge case | Report breaks on a condition containing a backtick |
| **Sev-4 Trivial** | Cosmetic | Typo, misaligned text |

## How to test here

- **CLI and backend tickets**: in the ticket's worktree, run `npm run compile`, then
  `node out/cli.js <command> ...`. Try it against this repo and against small sample files you write.
- **Editor tickets**: open the worktree in a new VS Code window (`code .worktrees/IT-103`), press F5
  to launch the Extension Development Host, and open a `.ts` file.
- **Report tickets**: run the command that produces the report, through the extension or `node out/cli.js`, and read the output.
- Test files and sample inputs you make go in `team/qa/`, which is your space.

## What Priya grades a bug report on

1. **Title** says what's wrong and where, e.g. *"`check --json` prints markdown when plan file is missing"*, not *"JSON broken"*
2. **Steps to reproduce** are exact, so someone else can paste them and get the same result
3. **Expected vs actual** are separate, specific, and quote the real output
4. **Environment**: branch or commit, OS, VS Code version if it matters
5. **Evidence**: output, screenshot or a minimal sample file
6. **Severity** is proposed with a one-line reason
7. **One bug per report**, no opinions, and nothing a dev could read as blame
