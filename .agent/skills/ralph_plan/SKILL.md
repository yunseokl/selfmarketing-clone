---
name: RalphPlan
description: The detailed planning protocol for Gemini. Used when entering PLANNING mode or starting a new feature.
---

# 🧠 RalphPlan (Planning Skill)

## 🎯 Purpose
To architect a solid foundation before coding. We do NOT guess; we plan, verify, and agree.

## 🚦 Trigger
*   New feature request from user.
*   Entering `PLANNING` mode.
*   Complexity rating > 5.

## 📝 Actions
1.  **Analyze Context**: Read `task.md`, `user_inputs.md`, and relevant source files.
2.  **Draft Plan**: Create or update `implementation_plan.md`.
    *   **Must Include**:
        *   User Review Required (Breaking changes, Policy decisions).
        *   Proposed Changes (File-by-file breakdown).
        *   Verification Plan (How to test).
3.  **Review Loop**:
    *   Present the plan to the user using `notify_user`.
    *   **DO NOT PROCEED** to execution until the user (or self-reflection in simple cases) approves.

## 📦 Output
*   Artifact: `implementation_plan.md`
