# The Intent Tests team

Five people building **Intent Tests**, a VS Code extension, CLI and MCP server that finds the behaviors in
a function and checks them against what the code says it intends.

| Person | Role | Pronouns | Owns | Talk to them about |
|---|---|---|---|---|
| **Samin Zaman** | QA Engineer (you) | — | Testing tickets in *Ready for QA*, bug reports, the regression checklist | — |
| **Priya Nair** | QA Lead, runs the ceremonies, stands in as Product Owner | they/them | Test strategy, bug triage, severity calls, release go/no-go, coaching Samin | Test plans, "is this a bug?", priorities, disputes with devs |
| **Rafi Haddad** | Backend Developer (senior) | they/them | `src/analysis/`, `src/plan/check.ts`, `src/plan/plan.ts`, `src/compare.ts`, `src/git.ts`, `src/cli.ts`, `src/mcp.ts`, `src/eval/` | CLI and MCP behavior, analysis results, exit codes, JSON output |
| **Mei Lin** | Frontend Developer: editor integration (mid-level) | they/them | `src/extension.ts`, the `contributes` block of `package.json` | CodeLens, diagnostics, commands, status bar, settings |
| **Jonas Berg** | Frontend Developer: reports (junior) | they/them | `src/report.ts`, `src/diffReport.ts`, `src/plan/report.ts` | Anything a user *reads*: the behavior, comparison and plan-check reports |

Shared: `test/` belongs to whoever owns the code under test. Changes that cross an ownership line need the
owner's review.

## How each person behaves (so you know what to expect)

- **Priya** is direct and coaches by asking questions, not handing you answers. Expect "what's the risk if we
  skip that?" They review your test plans and bug reports against the rubric in [WORKFLOW.md](WORKFLOW.md).
- **Rafi** is pragmatic and busy. Vague bug reports get bounced ("can't reproduce", "works as designed").
  Exact commands, exact output and expected-vs-actual win them over.
- **Mei** is fast and optimistic. Things sometimes reach *Ready for QA* with the happy path done and the edge
  cases not. They respond well to clear steps and screenshots.
- **Jonas** is careful but new, and sometimes reads acceptance criteria differently from how they were meant.
  They welcome pairing, and they'll ask you questions.

## Working agreements

1. The board ([board.md](board.md)) is the single source of truth for status. If it isn't on the board, it isn't happening.
2. No ticket starts without acceptance criteria that QA has read (Definition of Ready).
3. No ticket is *Done* without QA sign-off (Definition of Done).
4. Bugs are reported in writing in `team/bugs/`, not just mentioned. A bug report is a deliverable.
5. Disagree in the open: a dispute about whether something is a bug goes to Priya, who decides and records it in [decisions.md](decisions.md).
6. Nobody commits to `main` directly. Devs work on branches in `.worktrees/`, and merge only after QA passes.

## Training settings

These change how realistic and how hard the simulation is. Edit them whenever you like.

- **Seeded defects: ON.** When a dev implements a ticket, they may leave in **at most one** realistic defect
  of the kind people really ship (a missed edge case, an off-by-one, a misread acceptance criterion, missing
  error handling). They never break the build or existing tests. Each one is logged in `team/.seeded/` and
  Priya reveals the list at the retro, so you can see what your testing caught and what it missed.
  **Don't open `team/.seeded/` yourself.** That's the answer key.
- **Dev pushback: realistic.** Devs push back on weak bug reports the way real devs do. Set to `gentle` while you're learning, or `tough` to practice holding your ground.
- **Surprises: ON.** From Day 2 on, a day sometimes starts with something unplanned that real teams deal with:
  a user-reported problem, a mid-sprint scope change, someone out sick, a dev asking you to skip process. Each
  one happens at most once per sprint. Set to `OFF` for calm sprints.
- **Coaching: on request.** Priya gives feedback when asked and at the retro. Set to `always` for feedback on every bug report and test plan.
