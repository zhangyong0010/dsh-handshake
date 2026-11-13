/** Model-independent context capture: complete user evidence, attributed candidates, no LLM call. */
import fs from 'node:fs'
import path from 'node:path'
import { digest } from './workspace.js'
import { storeRoot } from './store.js'
import { sourceKey } from './identity.js'

export function redact(text) {
  return String(text ?? '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, '[REDACTED KEY]')
    .replace(/\b((?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|ACCESS_TOKEN|PASSWORD|SECRET)\s*[=:]\s*["']?)[^\s"'`;,]{8,}/g, '$1[REDACTED]')
}
/** Redact decoded strings; applying regexes to JSON escapes misses quoted assignments. */
export function redactValue(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,redactValue(item)]))
  return value
}
const CATEGORIES = {
  constraints: /必须|不要|不得|禁止|不能|保持|只允许|仅允许|must\b|do not\b|never\b|keep\b/i,
  decisions: /决定|确定|采用|同意|确认|选择|decid|agreed|chosen/i,
  verify: /验收|测试通过|检查通过|test.*pass|acceptance|verify/i,
  todos: /待办|还需要|下一步|尚未|未完成|todo\b|next step|remaining/i,
  openQuestions: /未决|待确认|尚不确定|open question|unresolved/i,
}
function instructionBody(text) {
  const request = /^## My request:\s*$/im.exec(text)
  return (request ? text.slice(request.index + request[0].length) : text)
    .replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```[^\n]*$/gm, '')
    .split('\n').filter((line) => !/^\s*>/.test(line)).join('\n').trim()
}
export function normalizeMessages(info, source) {
  const input = info.messages?.length ? info.messages : [
    ...(info.userTexts ?? [info.goal]).filter(Boolean).map((text) => ({ role: 'user', text })),
    ...(info.assistantTexts ?? [info.progress]).filter(Boolean).map((text) => ({ role: 'assistant', text })),
  ]
  const messages = []
  for (const [index, message] of input.entries()) {
    if (!['user', 'assistant'].includes(message.role) || !message.text?.trim()) continue
    const text = redact(message.text.trim())
    // Codex emits response_item and event_msg copies of the same message.
    if (messages.at(-1)?.text === text && messages.at(-1)?.role === message.role) continue
    const entry = { role: message.role, text, at: message.at ?? null, seq: message.seq ?? index,
      source: source.kind, sessionId: source.sessionId ?? source.codexSessionId, sourceFile: source.rolloutFile ?? info.sourceFile ?? null }
    entry.id = digest([entry.source, entry.sessionId, entry.role, entry.seq, text]).slice(0, 24)
    messages.push(entry)
  }
  return messages
}
export function captureContext(task, project, messages, snapshot, revision, { includeAssistant = true } = {}) {
  const user = messages.filter((message) => message.role === 'user')
  if (!user.length && !messages.some((message) => message.role === 'assistant') && !task.requirements?.length) throw new Error('没有可交接的任务正文')
  const candidates = []
  for (const message of user) {
    for (const text of instructionBody(message.text).split(/\n|(?<=[。！？])\s*/).map((line) => line.trim()).filter(Boolean)) {
      for (const [kind, pattern] of Object.entries(CATEGORIES)) if (pattern.test(text)) {
        candidates.push({ kind, text, sourceEntry: message.id, source: message.source, sessionId: message.sessionId, seq: message.seq, at: message.at, status: 'recorded' })
      }
    }
  }
  const dir = path.join(storeRoot(), 'packets', task.id, `round-${revision}`)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(redactValue(value), null, 2), { mode: 0o600 }); return { path: file, sha256: digest(fs.readFileSync(file)), required: true, kind: name } }
  const requirements = write('user-requests.json', { ordering: 'chronological-within-source-session', precedence: 'latest explicit user amendment supersedes earlier incompatible requirements; do not treat assistant suggestions as user approval', messages: user, candidates })
  const assistant = includeAssistant ? write('assistant-history.json', { authority: 'unverified-assistant-statements', messages: messages.filter((message) => message.role === 'assistant') }) : null
  if (assistant) assistant.required = false
  const safeSnapshot = redactValue(snapshot)
  const workspace = write('workspace.json', safeSnapshot)
  // Legacy project-wide evidence is retained on disk. Follow only references
  // attributable to this task's actual session lineage.
  const sameSession = (entry) => Boolean(entry.sessionId) && (entry.source === 'codex'
    ? entry.sessionId === task.links?.codexSessionId
    : sourceKey({ kind: 'dsh', sessionId: entry.sessionId }) === sourceKey({ kind: 'dsh', sessionId: task.links?.dshSessionId }))
  const legacy = task.rounds?.length ? (project.requirements ?? []).filter(sameSession) : []
  const history = task.requirements ?? legacy.flatMap((entry) => {
    try {
      const data = fs.readFileSync(entry.evidence)
      if (digest(data) !== entry.sha256) return [entry]
      const original = JSON.parse(data).messages.find((message) => message.id === entry.id)
      return [{ ...entry, text: original?.text ?? entry.excerpt }]
    } catch { return [entry] }
  })
  const known = new Set(history.map((entry) => entry.id))
  for (const message of user) if (!known.has(message.id)) {
    history.push({ id: message.id, source: message.source, sessionId: message.sessionId, at: message.at, seq: message.seq,
      evidence: requirements.path, sha256: requirements.sha256, excerpt: message.text.slice(0, 200), text: message.text })
  }
  task.requirements = history
  const firstRequest = history.find((entry) => entry.text || entry.excerpt) ?? user[0]
  const previousResult = task.rounds?.filter((round) => round.result).at(-1)?.result ?? null
  const initialGoal = instructionBody(firstRequest?.text ?? firstRequest?.excerpt ?? '') || task.title
  task.intent ??= { goal: initialGoal, sourceEntry: firstRequest?.id ?? null }
  const goal = project.goalConfirmed ? project.goal : task.intent.goal
  const authority = project.goalConfirmed ? 'user-maintained' : 'initial-user-request-with-historical-scope'
  const currentIds = new Set(user.map((message) => message.id))
  const prior = [...new Map(history.filter((entry) => !currentIds.has(entry.id) && entry.evidence && entry.sha256)
    .map((entry) => [entry.evidence, { path: entry.evidence, sha256: entry.sha256, required: false, kind: 'prior-user-evidence' }])).values()]
  const original = new Map([...history, ...user].map((message) => [message.id, message]))
  const instructions = [...original.values()].filter((message) => message.text || message.excerpt)
  const last = instructions.at(-1)
  const note = task.clarification ? { text: task.clarification, id: 'handoff-confirmation' } : null
  const inheritedNotes = [...new Map((task.rounds ?? [])
    .filter((round) => round.approval && round.status !== 'superseded' && round.clarificationScope === 'task' && round.clarification && round.clarification !== note?.text)
    .map((round) => [round.clarification, { text: round.clarification, revision: round.revision, id: `handoff-confirmation:${round.revision}` }])).values()]
  const persistentReadOnly = [...inheritedNotes, ...(note && task.clarificationScope === 'task' ? [note] : [])]
    .filter((entry) => currentScope([entry]).mode === 'read-only')
  const activeScope = currentScope([...instructions, ...(note ? [note] : []), ...persistentReadOnly, ...(project.constraints ?? []).filter((text) => currentScope([{ text }]).mode === 'read-only').map((text) => ({ text, id: `project:${project.id}:${project.masterRevision ?? 0}` }))])
  const attributed = (kind, limit) => instructions.flatMap((message) => instructionBody(message.text ?? message.excerpt ?? '')
    .split(/\n|(?<=[。！？])\s*/).filter((text) => CATEGORIES[kind].test(text))
    .map((text) => ({ text: text.trim(), sourceEntry: message.id }))).slice(-limit)
  const brief = {
    goal, goalSource: authority === 'user-maintained' ? { projectId: project.id, revision: project.masterRevision } : task.intent.sourceEntry,
    latestRequest: instructionBody(last?.text ?? last?.excerpt ?? ''), latestSource: last ? { id: last.id, source: last.source, sessionId: last.sessionId, seq: last.seq } : null,
    clarification: note?.text ?? null, clarificationScope: task.clarificationScope ?? null, inheritedNotes,
    scope: activeScope, explicitRules: project.constraints, acceptance: project.verify, decisions: project.decisions,
    recentConstraints: attributed('constraints', 6), suggestedAcceptance: attributed('verify', 4),
    progress: previousResult?.observed ?? { changedFiles: [], baselineFiles: snapshot.files.map((file) => file.path).slice(0, 30), checks: [] },
    remaining: (includeAssistant ? previousResult?.reported?.remaining : null) ?? candidates.filter((entry) => entry.kind === 'todos').slice(-4).map((entry) => entry.text),
    nextStep: includeAssistant ? previousResult?.reported?.nextStep ?? '' : '',
  }
  const briefRef = write('brief.json', brief)
  const lineage = write('task-requirements.json', { messages: instructions.map(({id, source, sessionId, seq, text, excerpt}) => ({id, source, sessionId, seq, text: text ?? excerpt})) })
  const master = write('project-master.json', { projectId: project.id, revision: project.masterRevision ?? 0, goal: project.goal,
    goalAuthority: project.goalConfirmed ? 'user-maintained' : 'initial-user-request-with-historical-scope',
    constraints: project.constraints, decisions: project.decisions, verify: project.verify, notes: project.notes,
    precedence: 'Confirmed rules are user-maintained. Read the task brief for scoped requirements.' })
  const references = [briefRef, lineage, master, { ...requirements, required: false }, workspace, ...(assistant ? [assistant] : []), ...prior, ...snapshot.references.map((reference) => ({ ...reference, required: reference.kind === 'project-rules' }))]
  const categories = (kind) => candidates.filter((entry) => entry.kind === kind)
  return {
    goal, goalAuthority: authority, brief,
    latestRequest: brief.latestRequest,
    recentRequests: user.slice(-4).map((message) => message.text),
    progress: includeAssistant ? messages.filter((message) => message.role === 'assistant').slice(-4).map((message) => message.text).join('\n\n') : '',
    constraints: [...project.constraints], decisions: [...project.decisions], verify: [...project.verify],
    candidates, todos: categories('todos').map((entry) => ({ text: entry.text, done: false, sourceEntry: entry.sourceEntry })),
    openQuestions: categories('openQuestions').map((entry) => entry.text),
    keyFiles: snapshot.files.map((file) => file.path), references,
    coverage: { userMessages: user.length, assistantMessages: messages.length - user.length, candidateCount: candidates.length,
      fullUserEvidence: true, redacted: messages.some((message) => message.text.includes('[REDACTED')), warnings: snapshot.warnings,
      interpretation: '自动提取的约束/决策仅为带来源线索；项目主档中的人工维护字段才是已确认规则。历史本轮要求须结合后续用户授权解释。' },
    artifactsDir: dir, snapshot: safeSnapshot,
  }
}

// Deliberately conservative. Infer permission only from explicit user wording,
// leaving ambiguous contradictions to the person confirming the handoff.
function currentScope(messages) {
  const readonly = /(?:只|仅)(?:做|需要|进行)?(?:读|分析|调研|审查|检查|评审|查看)|(?:不|不要|不得|禁止)(?:修改|改动|改写|改)(?:任何)?(?:代码|文件)|\b(?:read[- ]only(?: review| audit)?|review only)\b|\b(?:do not|don't) (?:edit|modify|change) (?:the )?(?:code|files)\b/i
  const allowWrite = /(?:^|[。！？；，,\n]|请|可以|允许|开始|现在|本轮|此轮|先|直接|需要你)\s*(?:你|先|开始|进行|来|直接|做|把|完成|实现|给我|将){0,4}(?:修改|修复|更改|更新|开发|实现|改动)|\b(?:please|now|go ahead and|you may) (?:implement|fix|edit|modify)\b/i
  for (const message of [...messages].reverse()) {
    const text = instructionBody(message.text ?? message.excerpt ?? '')
    const segments = text.split(/(?<=[。！？；])|\n/).filter((line) => !/^(?:如果|假如|以后|后续|下轮|if\b|later\b)/i.test(line.trim()))
    const read = segments.some((segment) => readonly.test(segment))
    const write = segments.some((segment) => allowWrite.test(segment))
    if (read || write) return { mode: read && write ? 'conflict' : read ? 'read-only' : 'workspace-write', sourceEntry: message.id }
  }
  return { mode: 'workspace-write', sourceEntry: null }
}
