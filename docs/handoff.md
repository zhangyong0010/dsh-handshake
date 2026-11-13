# Handoff documents

Application version: 0.2.0. Internal packet schema: dsh-handshake/packet@3.

Local data lives under ~/.dsh-handshake, outside this repository. Never commit it.

| Record | Purpose |
| --- | --- |
| projects/<id>.json | Stable project identity, directory aliases and user-maintained agreement. |
| tasks/<id>.json | Current project handoff state, linked client sessions and historical revisions. |
| packets/<task>/round-N/packet.json | Versioned manifest and digest for one preparation. Refreshing changed evidence creates another revision; it does not execute a model. |
| user-requests.json | Full attributed user messages from the source session. Earlier source evidence remains linked when a task changes clients. |
| assistant-history.json | Unverified assistant statements, retained separately. |
| project-master.json | Agreement snapshot and references to original user evidence. An imported initial goal remains marked as historical until maintained explicitly. |
| workspace.json | Branch, HEAD, staged/unstaged diff and changed/untracked file hashes. Non-Git directories use a bounded file inventory. |
| receipt.json | Receiving-side file and baseline check bound to the manifest digest and revision. |

The rendered prompt is a guide with explicitly marked previews. It is not the only source of truth. Generated handoff prompts are excluded from new user authorization, so round trips do not turn assistant summaries into user instructions.

Execution refreshes source evidence first. If the agreement, source or code changed, it stages updated documents and requires another confirmation. The local project lock coordinates plugin starts but cannot fence unrelated external writers.

Codex runs through the local desktop runtime with the project's working directory and workspace-write sandbox. Only the current artifact directory is additionally made writable for the receipt. The exact returned thread ID is used to link results. DSH uses sessionController with an AbortSignal and idempotent request IDs.

Required files and the baseline are checked before a receipt is written. A receiver is instructed to read the complete documents first, but the host cannot enforce an LLM's reading or writing order. A receipt does not prove semantic understanding. Successful process exit or a new DSH turn/end moves the task to awaiting-review, not automatic acceptance.

Git snapshots cover the tracked repository baseline plus staged, unstaged and non-ignored untracked changes. Ignored files and external services are not a complete machine snapshot. Non-Git inventory stops above 5,000 files. Large diffs produce an explicit warning. Client storage formats and controller APIs may change upstream.

A host crash during the narrow launch window can require manual log inspection. Missing results are not treated as success. Task-card deletion archives historical duplicate records before removing the visible card; it does not erase source conversations.
