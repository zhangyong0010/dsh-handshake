# Changelog

## 0.1.0

Initial public release. The plugin and UI versions remain 0.1.0 and v0.1.

- Prepare and confirm handoffs in both directions between Codex and DeepSeek Harness.
- Distinguish active handoffs, Codex sources and DSH sources with green, purple and blue sections.
- Group source sessions by project and reuse one project handoff card across multiple rounds.
- Preserve original user evidence and editable project agreements separately from assistant claims and extracted candidates.
- Keep immutable handoff documents, workspace snapshots and version-bound document receipts.
- Recheck source and workspace changes before execution; coordinate a single plugin-managed writer per project.
- Preserve destination session links, make retries visible and wait for user review after a run ends.
- Exclude quota modules and unsupported internal automation-file fallback.

Validation: 38 isolated contract and regression tests, JavaScript syntax checks and native DSH panel checks. Tests use simulated receivers; real-model end-to-end development acceptance remains unverified.
