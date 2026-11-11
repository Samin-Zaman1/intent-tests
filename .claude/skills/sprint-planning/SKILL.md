---
name: sprint-planning
description: Run sprint planning. The team reviews the backlog, estimates, flags risks, and commits to a sprint.
---

Run sprint planning for the Intent Tests team.

1. Read `team/board.md` and every ticket in `team/tickets/`.
2. Ask `qa-lead` to open the meeting: restate the sprint goal as PO and propose an order for the tickets.
3. Launch `be-dev`, `fe-dev-editor` and `fe-dev-reports` in parallel. Ask each one to read their own tickets and give
   (a) whether they agree with the estimate, and (b) one risk or dependency. Example: IT-101 and IT-106 both touch
   plan-check output, so Rafi and Jonas need to agree on a shape.
4. Show all of it, then **stop and ask Samin**: which tickets look hardest to test and why, how much test effort
   they expect for each, and whether anything should be cut. Wait for their answer.
5. Pass Samin's input to `qa-lead`, who makes the final commit as PO. Record the committed scope and any cuts in
   `team/decisions.md`. Update the sprint status in `team/board.md` to "In progress".
6. Remind Samin that no ticket is Ready until `/refinement <ticket>` has been done.
