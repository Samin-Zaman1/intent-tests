---
name: standup
description: Run the team's daily standup. Every teammate gives yesterday, today and blockers, and Samin gives theirs.
---

Run the daily standup for the Intent Tests team. See `team/WORKFLOW.md`.

1. Read `team/board.md` and the last entry in `team/standups.md`.
2. Launch these four agents **in parallel**: `be-dev`, `fe-dev-editor`, `fe-dev-reports` and `qa-lead`. Give each one
   this instruction: "Daily standup for <today's date>. Give your update in 3 short lines (Yesterday / Today /
   Blockers), based on the board and your journal. If you're blocked on someone, name them. Don't start new work."
3. Show the updates in this order: Rafi, Mei, Jonas, Priya. Put each under a bold name and role, using the
   teammate's own words.
4. Then ask Samin for their update and **stop**. Wait for their reply. Don't write Samin's update for them.
5. Once Samin answers, append the whole standup to the top of `team/standups.md`, including Samin's update and any
   follow-ups (for example "Rafi and Samin to look at BUG-002 after standup"). If something Samin said needs a
   reply from someone (a blocker, a question), pass it to that teammate and show their answer.
