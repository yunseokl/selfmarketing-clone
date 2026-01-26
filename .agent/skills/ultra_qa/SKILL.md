---
name: UltraQA
description: The verification protocol for Gemini. Used before declaring a task complete.
---

# 🧪 Ultra QA (Verification Skill)

## 🎯 Purpose
To ensure zero-defect delivery. We trust, but we verify.

## 🚦 Trigger
*   Implementation finished.
*   Entering `VERIFICATION` mode.

## 📝 Actions
1.  **QC (Quality Control) - Machine Check**:
    *   Run `npm run build` (Must pass with Exit Code 0).
    *   Run `npm run lint`.
    *   Check console for runtime errors.
2.  **QA (Quality Assurance) - Human Sim**:
    *   **Happy Path**: Can I login? Can I add data?
    *   **Edge Case**: What if API key is missing? What if network is slow?
    *   **UX**: Is it consistent? Is it responsive?
3.  **Report**:
    *   Update `qa_report.md` with Pass/Fail status.
    *   Fix any Failures immediately (Switch back to Ralph mode if needed).

## 📦 Output
*   Artifact: `qa_report.md`
*   Final Git Commit
