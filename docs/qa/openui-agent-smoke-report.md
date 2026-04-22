# Kitto OpenUI Smoke Report

Use this file for recording smoke-run outcomes.
Do not write test results into `docs/qa/openui-agent-smoke.md`; keep that file as the checklist only.

## Run Info

- Date:
- Tester:
- Branch / commit:
- Environment:
- App URL:
- Notes:

## Summary

- Overall result:
- Main regressions:
- Blockers:
- Follow-ups:

## Scenario Results

| Scenario | Result | Notes |
| --- | --- | --- |
| 0. Runtime config and prompt docs page | TODO |  |
| 1. Simple todo stays simple | TODO |  |
| 2. Multi-screen local flow | TODO |  |
| 3. Follow-up edit preserves existing app | TODO |  |
| 4. Theme / appearance / active theme button | TODO |  |
| 5. Inputs and validation | TODO |  |
| 6. Collections and filtering | TODO |  |
| 7. Safe compute tools | TODO |  |
| 8. Persistence, reload, undo and redo | TODO |  |
| 9. JSON import/export and invalid import recovery | TODO |  |
| 10. Draft issues and auto-repair | TODO |  |
| 11. Standalone HTML export | TODO |  |
| 12. Cancel and stale request recovery | TODO |  |

## Final Checks

| Check | Result | Notes |
| --- | --- | --- |
| No uncaught Console errors | TODO |  |
| Preview internal clicks do not trigger fresh `/api/llm/generate*` requests | TODO |  |
| Oversized requests are blocked in the UI before generation | TODO |  |
| Invalid drafts/imports do not replace committed preview | TODO |  |
| Import/export works | TODO |  |
| Undo/redo works | TODO |  |
| Reload restores app state | TODO |  |
| Colors/theme remain readable | TODO |  |
| Filtering works locally | TODO |  |
| Compute actions work locally | TODO |  |
| Runtime-config badge is not stuck in `loading` | TODO |  |
| Prompts reference page matches the backend prompt snapshot | TODO |  |
