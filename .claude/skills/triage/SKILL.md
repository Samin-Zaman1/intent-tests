---
name: triage
description: Bug triage. Priya reviews new bugs, sets severity and priority, and assigns owners. The owning devs respond.
---

Run bug triage.

1. Find every bug in `team/bugs/` whose status is New.
2. If there aren't any, say so and stop.
3. Ask `qa-lead` to triage each one: confirm or change the severity (with a reason), set the priority, assign
   the owner, update the bug and `team/board.md`, and give Samin brief feedback on report quality against the
   rubric. Show the result.
4. Launch the owning devs in parallel. Each one reads their assigned bugs and responds in character, following
   their pushback setting. They may try to reproduce, but they don't fix anything yet. Show their responses.
5. If a dev disputes a bug, **stop and ask Samin** whether they want to defend it. Samin's reply goes to
   `qa-lead`, who decides and records it in `team/decisions.md`.
