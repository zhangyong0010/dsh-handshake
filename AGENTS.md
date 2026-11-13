# Development notes

- Package version stays 0.2.1 and the UI stays v0.2.1 until the maintainer explicitly requests a version change.
- Only Codex and DeepSeek Harness handoffs are supported. Keep documentation and release claims limited to verified behavior.
- Preserve user evidence with provenance; historical assistant output and reference documents are not new user authorization.
- Agent tools may prepare and inspect handoffs. Execution stays a user action.
- Keep one project card with immutable handoff revisions. Do not group unrelated projects by basename alone.
- Preserve the green handoff, purple Codex and blue DSH visual distinction and equal-height source cards.
- Run npm test with Node.js 24+. Tests must use isolated homes and simulated receivers; do not launch real models as a substitute for contract tests.
- Never commit local sessions, handoff packets, credentials, personal paths, logs, backups or generated runtime state.
- A read receipt is not proof of semantic understanding or task acceptance. Do not claim real-model acceptance from fixture tests.
