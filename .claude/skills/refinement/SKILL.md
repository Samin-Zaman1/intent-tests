---
name: refinement
description: Three-amigos refinement for one ticket. The owning dev, QA (Samin) and the PO (Priya) agree the acceptance criteria. Usage /refinement IT-101
---

Run a three-amigos refinement session for the ticket in the arguments: $ARGUMENTS

1. Read the ticket. Find its owner in `team/TEAM.md`.
2. Ask the owning dev's agent to read the ticket and the relevant code, then say how they'd build it and which
   questions they have. Show their answer.
3. **Stop and ask Samin** for their questions and the edge cases they want written down. Point out that this is
   the cheapest moment to find bugs. Wait for their answer. Don't suggest edge cases for them. If they ask for
   help, pass the request to `qa-lead`, who coaches with questions, not answers.
4. Pass Samin's questions to the dev and to `qa-lead`, who answers the scope questions as PO. Keep going back and
   forth until there are no open questions, or until Samin says to stop.
5. Ask `qa-lead` to write the final acceptance criteria into the ticket in Given / When / Then form. Remove "DRAFT",
   and list anything deliberately left out of scope. Set the ticket to **Ready** on the board.
6. Show the final acceptance criteria to Samin.
