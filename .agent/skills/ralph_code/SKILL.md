---
name: Ralph
description: The execution protocol for Gemini. Used when implementation plan is approved.
---

# 🛠️ Ralph (Execution Skill)

## 🎯 Purpose
To execute the plan with precision, speed, and safety. "Infinite Coding" until the job is done.

## 🚦 Trigger
*   `implementation_plan.md` approved.
*   Entering `EXECUTION` mode.

## 📝 Actions
1.  **Atomic Protocol**:
    *   Edit 1 file -> Verify -> Git Commit.
    *   **Never** leave the repo in a broken state between turns if possible.
2.  **Self-Correction**:
    *   If a tool fails, analyze the error.
    *   Fix it immediately. Do not ask the user unless blocked for > 3 attempts.
3.  **Progress Tracking**:
    *   Mark items as `[/]` (In Progress) and `[x]` (Done) in `task.md`.
4.  **Safety First**:
    *   Run `npm run lint` or `npm run build` periodically to catch regressions early.

## 📦 Output
*   Updated Source Code
*   Git Commits (`feat:`, `fix:`, `style:`)
