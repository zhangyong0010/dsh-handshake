import fs from 'node:fs'
import path from 'node:path'
import { decompressFrames } from './zstd.js'
import { fileIdentity } from './identity.js'
import { homeDir } from './util.js'

export function codexHome() {
  return path.join(homeDir(), '.codex')
}

export function codexProjectNames() {
  let desktop = {}
  try { desktop = JSON.parse(fs.readFileSync(path.join(codexHome(), '.codex-global-state.json'), 'utf8')) ?? {} } catch { /* optional desktop metadata */ }
  const projects = new Map()
  const membership = new Map()
  for (const [id, project] of Object.entries(desktop['local-projects'] ?? {})) {
    if (typeof project?.name === 'string' && project.name.trim()) projects.set(id, { name: project.name.trim(), roots: Array.isArray(project.rootPaths) ? project.rootPaths : [] })
  }
  for (const [id, assignment] of Object.entries(desktop['thread-project-assignments'] ?? {})) {
    if (assignment?.projectKind === 'local' && typeof assignment.projectId === 'string') membership.set(id, assignment.projectId)
  }
  // Desktop builds that have migrated projects store the live title here.
  let db
  try {
    const file = fs.readdirSync(codexHome()).filter((name) => /^state_\d+\.sqlite$/.test(name)).sort((a,b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))[0]
    if (file) {
      const { DatabaseSync } = process.getBuiltinModule?.('node:sqlite') ?? {}
      if (!DatabaseSync) throw new Error('SQLite unavailable')
      db = new DatabaseSync(path.join(codexHome(), file), { readOnly: true, timeout: 100 })
      const migrated = new Map()
      for (const row of db.prepare('SELECT p.id, p.name, r.path FROM projects p JOIN project_roots r ON r.project_id = p.id').all()) {
        const project = migrated.get(row.id) ?? { name: row.name, roots: [] }
        project.roots.push(row.path)
        migrated.set(row.id, project)
      }
      for (const map of Object.values(desktop['app-server-project-id-by-legacy-project-id-by-host'] ?? {})) {
        if (!map || typeof map !== 'object') continue
        for (const [legacy, current] of Object.entries(map)) if (migrated.has(current)) projects.set(legacy, migrated.get(current))
      }
      for (const [id, project] of migrated) projects.set(id, project)
      for (const row of db.prepare('SELECT id, project_id FROM threads WHERE project_id IS NOT NULL').all()) {
        if (projects.has(row.project_id)) membership.set(row.id, row.project_id)
      }
    }
  } catch { /* the desktop state is version-dependent; use the available metadata */ }
  finally { try { db?.close() } catch { /* optional index */ } }
  return { projects: [...new Set(projects.values())], forSession: (id) => projects.get(membership.get(id))?.name ?? null }
}

function sessionsRoot() {
  return path.join(codexHome(), 'sessions')
}

/** Recursively collect rollout files under ~/.codex/sessions, newest first. */
export function listRolloutFiles(limit = 200) {
  const root = sessionsRoot()
  const found = []
  const walk = (dir, depth) => {
    if (depth > 6) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.isFile() && /\.jsonl(\.zst)?$/.test(entry.name)) found.push(full)
    }
  }
  walk(root, 0)
  const scored = []
  for (const file of found) {
    try {
      const stat = fs.statSync(file)
      scored.push({ file, mtimeMs: stat.mtimeMs, size: stat.size, stamp: fileStamp(stat) })
    } catch {
      /* skip */
    }
  }
  scored.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return scored.slice(0, limit)
}

/** Read the first `headBytes` and last `tailBytes` of a file as text. */
function readHeadTail(file, headBytes = 256 * 1024, tailBytes = 128 * 1024) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const headBuffer = Buffer.alloc(Math.min(headBytes, size))
    fs.readSync(fd, headBuffer, 0, headBuffer.length, 0)
    let tailText = ''
    if (tailBytes && size > headBytes) {
      const tailLength = Math.min(tailBytes, size - headBytes)
      const tailBuffer = Buffer.alloc(tailLength)
      fs.readSync(fd, tailBuffer, 0, tailLength, size - tailLength)
      tailText = tailBuffer.toString('utf8')
    }
    return { head: headBuffer.toString('utf8'), tail: tailText, size }
  } catch {
    return { head: '', tail: '', size: 0 }
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

function parseLines(text) {
  const records = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed[0] !== '{') continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      /* tolerate partial tails */
    }
  }
  return records
}

export function isCodexUsageLimit(error, message) {
  return /usage.?limit|rate.?limit|quota|额度/i.test(JSON.stringify([error, message]))
}

function harvestRollout(records) {
  const userTexts = []
  const assistantTexts = []
  const messages = []
  const toolPaths = new Set()
  const toolNames = new Set()
  let meta = null
  let tokens = null
  let running = null
  let interruption = null

  const collectMessage = (payload, record) => {
    if (!payload || typeof payload !== 'object') return
    const role = payload.role ?? payload.type ?? null
    const contents = Array.isArray(payload.content) ? payload.content : []
    for (const part of contents) {
      const kind = part?.type ?? ''
      const text = typeof part?.text === 'string' ? part.text : null
      if (text === null) continue
      if (role === 'user' && pickTaskText([text])) { userTexts.push(text); messages.push({ role, text, seq: record.seq ?? messages.length, at: record.timestamp ?? null }) }
      else if (role === 'assistant') { assistantTexts.push(text); messages.push({ role, text, seq: record.seq ?? messages.length, at: record.timestamp ?? null }) }
    }
    if (typeof payload.message === 'string') {
      if (role === 'user' && pickTaskText([payload.message])) { userTexts.push(payload.message); messages.push({ role, text: payload.message, seq: record.seq ?? messages.length, at: record.timestamp ?? null }) }
      else if (role === 'assistant') { assistantTexts.push(payload.message); messages.push({ role, text: payload.message, seq: record.seq ?? messages.length, at: record.timestamp ?? null }) }
    }
  }

  const collectCall = (payload) => {
    if (!payload || typeof payload !== 'object') return
    if (typeof payload.name === 'string') toolNames.add(payload.name)
    const argsRaw = payload.arguments ?? payload.input ?? null
    const scan = (value, depth) => {
      if (value === null || depth > 8) return
      if (typeof value === 'string') {
        if (/^(\/|~\/|\.{1,2}\/)/.test(value) && value.length < 512 && !/[\n\r]/.test(value)) toolPaths.add(value)
        else if (value.trim().startsWith('{')) {
          try {
            scan(JSON.parse(value), depth + 1)
          } catch {
            /* not JSON */
          }
        }
        return
      }
      if (Array.isArray(value)) {
        for (const item of value) scan(item, depth + 1)
        return
      }
      if (typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (typeof child === 'string' && /^(path|file_?path|filename)$/i.test(key)) toolPaths.add(child)
          else scan(child, depth + 1)
        }
      }
    }
    scan(argsRaw, 0)
  }

  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const type = record.type ?? ''
    const payload = record.payload ?? record
    if (type === 'session_meta') meta = payload
    else if (type === 'response_item') {
      const inner = payload
      const innerType = inner?.type ?? ''
      if (innerType === 'message') collectMessage(inner, record)
      else if (innerType === 'function_call' || innerType === 'custom_tool_call') collectCall(inner)
    } else if (type === 'event_msg') {
      const innerType = payload?.type ?? ''
      if (innerType === 'task_started') { running = true; interruption = null }
      if (['task_complete','task_completed','turn_aborted','task_failed'].includes(innerType)) running = false
      if (innerType === 'error' && running !== false) {
        const error = payload.codex_error_info ?? payload.codexErrorInfo
        if (isCodexUsageLimit(error, payload.message)) {
          interruption = 'usage-limit'
          running = null
        }
      }
      if (innerType === 'user_message' || innerType === 'agent_message') {
        collectMessage({ role: innerType === 'user_message' ? 'user' : 'assistant', message: payload.message }, record)
      }
    } else if (type === 'message') collectMessage(payload, record)

    if (type === 'token_count' || type === 'token_usage_record') tokens = payload
  }

  return { meta, userTexts, assistantTexts, messages, running, interruption, toolPaths: [...toolPaths], toolNames: [...toolNames], tokens }
}

const fileStamp = (stat) => [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
const parsedFiles = new Map()
export function parseRollout(file) {
  const key = path.resolve(file)
  let text
  let stat
  try {
    stat = fs.statSync(file)
    const saved = parsedFiles.get(key)
    if (saved?.stamp === fileStamp(stat)) return { ...saved.value, file }
    if (file.endsWith('.zst')) {
      text = decompressFrames(fs.readFileSync(file))
    } else {
      text = fs.readFileSync(file, 'utf8')
    }
  } catch (error) {
    return { error: `cannot read rollout: ${error?.message ?? error}` }
  }
  const harvested = harvestRollout(parseLines(text))
  const meta = harvested.meta ?? {}
  const value = {
    file,
    sessionId: meta.session_id ?? meta.id ?? null,
    projectDir: meta.cwd ?? null,
    originator: meta.originator ?? null,
    cliVersion: meta.cli_version ?? null,
    createdAt: meta.timestamp ?? null,
    userTexts: harvested.userTexts,
    messages: harvested.messages,
    running: harvested.running,
    interruption: harvested.interruption,
    assistantTexts: harvested.assistantTexts,
    toolPaths: harvested.toolPaths,
    toolNames: harvested.toolNames,
    tokens: harvested.tokens,
  }
  try {
    if (stat.size <= 8 * 1024 * 1024 && fileStamp(stat) === fileStamp(fs.statSync(file))) {
      parsedFiles.delete(key)
      parsedFiles.set(key,{ stamp:fileStamp(stat),value })
      if (parsedFiles.size > 4) parsedFiles.delete(parsedFiles.keys().next().value)
    }
  } catch { /* the file moved during parsing */ }
  return { ...value }
}

/** Codex-internal reviewer threads (approval assessments) are not user tasks. */
const INTERNAL_TITLE = /^(You are judging|The following is the Codex agent history|Use prior reviews as context)/

/** Codex seeds threads with instruction/context blobs before the real request. */
const INSTRUCTION_TEXT = /^(You are Codex|System:|Developer message|# AGENTS\.md instructions|Host notice:|(\[[0-9]+\] )*Retained source order|>>>)|^<[^>]{1,80}>/

/**
 * Pick the first user text that is an actual task request rather than a
 * seeded instruction/context blob.
 */
export function pickTaskText(texts) {
  const list = Array.isArray(texts) ? texts : []
  for (const text of list) {
    const trimmed = String(text ?? '').trim()
    if (/^# DSH-Handshake|^# Handshake 接收核对/.test(trimmed)) continue
    if (/^# Files mentioned by the user:/i.test(trimmed) && !/^## My request:/m.test(trimmed)) continue
    if (trimmed !== '' && !INSTRUCTION_TEXT.test(trimmed) && !INTERNAL_TITLE.test(trimmed)) return trimmed
  }
  return ''
}

/** Attachment metadata stays in the packet; the title leads with the actual request. */
export function taskTitle(text) {
  const request = String(text ?? '').split(/^## My request:\s*$/m).at(-1).trim()
  return (request.split('\n').find((line) => line.trim()) ?? '').slice(0, 120)
}

const threadMetadata = new Map()
export function listCodexThreads(limit = 20) {
  const threads = []
  const seenSessions = new Set()
  const entries = listRolloutFiles(limit * 6)
  const present = new Set(entries.map((entry) => entry.file))
  for (const file of threadMetadata.keys()) if (!present.has(file)) threadMetadata.delete(file)
  for (const entry of entries) {
    if (threads.length >= limit) break
    if (entry.file.endsWith('.zst')) continue
    let cached = threadMetadata.get(entry.file)
    if (cached?.stamp !== entry.stamp) {
      const { head, tail } = readHeadTail(entry.file)
      const { meta, userTexts } = harvestRollout([...parseLines(head), ...parseLines(tail)])
      const sessionId = meta?.session_id ?? meta?.id
      const title = taskTitle(pickTaskText(userTexts))
      const row = sessionId && title && !INTERNAL_TITLE.test(title) && !INSTRUCTION_TEXT.test(title)
        ? { file:entry.file, sessionId, projectDir:meta.cwd ?? '', title, lastActivity:new Date(entry.mtimeMs).toISOString() }
        : null
      cached = { stamp:entry.stamp, row }
      threadMetadata.set(entry.file,cached)
    }
    if (!cached.row || seenSessions.has(cached.row.sessionId)) continue
    seenSessions.add(cached.row.sessionId)
    threads.push(cached.row)
  }
  return threads
}

/** Associate a run only with its exact thread and project, never another active client. */
export function findRunSessionFile(sinceMs, expected = {}) {
  if (!expected.sessionId) return null
  const entries = listRolloutFiles(Infinity).filter((entry) => !entry.file.endsWith('.zst') && entry.mtimeMs >= sinceMs - 5000)
  const named = entries.filter((entry) => path.basename(entry.file,'.jsonl').endsWith(`-${expected.sessionId}`))
  const names = new Set(named.map((entry) => entry.file))
  const directory = fileIdentity(expected.projectDir)
  for (const entry of [...named,...entries.filter((entry) => !names.has(entry.file))]) {
    const { head } = readHeadTail(entry.file,256 * 1024,0)
    const meta = parseLines(head).find((record) => record.type === 'session_meta')?.payload
    if ((meta?.session_id ?? meta?.id) !== expected.sessionId) continue
    if (directory && fileIdentity(meta?.cwd) !== directory) continue
    return entry
  }
  return null
}
