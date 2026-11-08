/** Model-independent context capture: complete user evidence, attributed candidates, no LLM call. */
import fs from 'node:fs'
import path from 'node:path'
import { digest } from './workspace.js'
import { storeRoot } from './store.js'
import { saveProject } from './projects.js'

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
export function captureContext(task, project, info, snapshot, revision) {
  const messages = normalizeMessages(info, task.source)
  const user = messages.filter((message) => message.role === 'user')
  if (!user.length && !messages.some((message) => message.role === 'assistant')) throw new Error('没有可交接的任务正文')
  const candidates = []
  for (const message of user) {
    for (const text of message.text.split(/\n|(?<=[。！？])\s*/).map((line) => line.trim()).filter(Boolean)) {
      for (const [kind, pattern] of Object.entries(CATEGORIES)) if (pattern.test(text)) {
        candidates.push({ kind, text, sourceEntry: message.id, source: message.source, sessionId: message.sessionId, seq: message.seq, at: message.at, status: 'recorded' })
      }
    }
  }
  const dir = path.join(storeRoot(), 'packets', task.id, `round-${revision}`)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(redactValue(value), null, 2), { mode: 0o600 }); return { path: file, sha256: digest(fs.readFileSync(file)), required: true, kind: name } }
  const requirements = write('user-requests.json', { ordering: 'chronological-within-source-session', precedence: 'latest explicit user amendment supersedes earlier incompatible requirements; do not treat assistant suggestions as user approval', messages: user, candidates })
  const assistant = write('assistant-history.json', { authority: 'unverified-assistant-statements', messages: messages.filter((message) => message.role === 'assistant') })
  assistant.required = false
  const safeSnapshot = redactValue(snapshot)
  const workspace = write('workspace.json', safeSnapshot)
  const known = new Set(project.requirements.map((entry) => entry.id))
  for (const message of user) if (!known.has(message.id)) {
    project.requirements.push({ id: message.id, source: message.source, sessionId: message.sessionId, at: message.at, seq: message.seq,
      evidence: requirements.path, sha256: requirements.sha256, excerpt: message.text.slice(0, 200) })
  }
  if (!project.goal) project.goal = user[0]?.text ?? task.title
  const master = write('project-master.json', { projectId: project.id, revision: project.masterRevision ?? 0, goal: project.goal,
    goalAuthority: project.goalConfirmed ? 'user-maintained' : 'initial-user-request-with-historical-scope',
    constraints: project.constraints, decisions: project.decisions, verify: project.verify, notes: project.notes,
    requirements: project.requirements, precedence: 'Confirmed rule arrays are user-maintained. An unconfirmed goal is only the initial user request, including its historical scope. Read evidence in order and respect later explicit amendments. Missing fields are unknown, never invented.' })
  const currentIds = new Set(user.map((message) => message.id))
  const prior = [...new Map(project.requirements.filter((entry) => !currentIds.has(entry.id)).map((entry) => [entry.evidence, { path: entry.evidence, sha256: entry.sha256, required: true, kind: 'prior-user-evidence' }])).values()]
  project.sessions[task.source.kind] = { ...task.source, projectDir: task.projectDir, lastCapturedAt: new Date().toISOString() }
  saveProject(project)
  const references = [master, requirements, workspace, assistant, ...prior, ...snapshot.references.map((reference) => ({ ...reference, required: reference.kind === 'project-rules' }))]
  const categories = (kind) => candidates.filter((entry) => entry.kind === kind)
  return {
    goal: project.goal,
    goalAuthority: project.goalConfirmed ? 'user-maintained' : 'initial-user-request-with-historical-scope',
    latestRequest: user.at(-1)?.text ?? '',
    recentRequests: user.slice(-4).map((message) => message.text),
    progress: messages.filter((message) => message.role === 'assistant').slice(-4).map((message) => message.text).join('\n\n'),
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
