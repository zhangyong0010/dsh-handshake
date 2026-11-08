/**
 * Extract handoff context from a DSH session.
 *
 * Primary source: the `sessionQuery` Host service (handles the durable log in
 * any format). Fallback: the session's on-disk log file. Both feed one tolerant
 * harvester — session event schemas evolve, so the harvester collects by shape
 * (role-tagged texts, tool names, path-looking strings) instead of trusting
 * exact field names, and a sparse result is always acceptable.
 */
import fs from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import path from 'node:path'
import { decompressFrames } from './zstd.js'
import { sessionId as normalizeId } from './identity.js'
import { pickTaskText } from './codex.js'
import { homeDir } from './util.js'

const isDelegated = (header) => header?.origin === 'subagent' || Number(header?.delegationDepth) > 0

function diskHeader(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 256 * 1024))
    fs.readSync(fd, buffer, 0, buffer.length, 0)
    // The first independent frame holds the header; no body scan is needed here.
    return JSON.parse(zstdDecompressSync(buffer).toString('utf8').split('\n')[0])
  } catch { return null } finally { if (fd !== undefined) fs.closeSync(fd) }
}

/** Recursively harvest texts/tool names/paths from unknown session data. */
export function harvest(records) {
  const userTexts = []
  const assistantTexts = []
  const messages = []
  let currentRecord = null
  const toolNames = new Set()
  const filePaths = new Set()

  const pathKey = /^(path|file_?path|filepath|filename)$/i
  const textKey = /^(text|input_text|output_text|content_?text)$/i

  const visit = (value, role, depth) => {
    if (value === null || value === undefined || depth > 24) return
    if (typeof value === 'string') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, role, depth + 1)
      return
    }
    if (typeof value !== 'object') return

    let nextRole = role
    if (value.role === 'user' || value.role === 'assistant' || value.role === 'system') nextRole = value.role

    const type = typeof value.type === 'string' ? value.type : ''
    if (type === 'function_call' || type === 'tool_call' || type === 'tool_use') {
      if (typeof value.name === 'string') toolNames.add(value.name)
    }
    if (type === 'tool' && typeof value.name === 'string') toolNames.add(value.name)

    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string') {
        if (pathKey.test(key) && looksLikePath(child)) filePaths.add(child)
        else if (textKey.test(key) && child.trim() !== '') {
          const text = child.trim()
          if (nextRole === 'user') {
            if (pickTaskText([text])) { userTexts.push(text); messages.push({ role: 'user', text, seq: currentRecord?.seq ?? messages.length, at: currentRecord?.time ?? currentRecord?.timestamp ?? null }) }
          } else if (nextRole === 'assistant') {
            assistantTexts.push(text); messages.push({ role: 'assistant', text, seq: currentRecord?.seq ?? messages.length, at: currentRecord?.time ?? currentRecord?.timestamp ?? null })
          }
        }
      } else {
        visit(child, nextRole, depth + 1)
      }
    }
  }

  const hasCanonical = Array.isArray(records) && records.some((record) => ['user/message','assistant/message'].includes(record.type))
  for (const record of Array.isArray(records) ? records : [records]) {
    currentRecord = record
    if (hasCanonical && !['user/message','assistant/message'].includes(record?.type)) {
      // Traverse tooling without treating replayed inbox/system messages as authored requests.
      const scanPaths = (value) => {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (pathKey.test(key) && typeof child === 'string' && looksLikePath(child)) filePaths.add(child)
          else if (child && typeof child === 'object') scanPaths(child)
        }
      }
      scanPaths(record); continue
    }
    visit(record, null, 0)
  }
  return { userTexts, assistantTexts, messages, toolNames: [...toolNames], filePaths: [...filePaths] }
}

function looksLikePath(value) {
  if (value.length < 2 || value.length > 512) return false
  if (/[\n\r]/.test(value)) return false
  return /^(\/|~\/|\.{1,2}\/)/.test(value) || /^[A-Za-z]:[\\/]/.test(value)
}

/** Best-effort title extraction from a readTitle result. */
function titleFrom(value) {
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object') {
    for (const key of ['title', 'text', 'value', 'displayTitle']) {
      const found = titleFrom(value[key])
      if (found) return found
    }
  }
  return null
}

function truncate(text, max) {
  const s = String(text ?? '').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** Locate the on-disk log directory of one session, if any. */
function findSessionDir(sessionId) {
  const base = path.join(homeDir(), '.dsh', 'sessions')
  let groups = []
  try {
    groups = fs.readdirSync(base)
  } catch {
    return null
  }
  for (const group of groups) {
    const dir = path.join(base, group, `session-${sessionId}`)
    try {
      if (fs.statSync(dir).isDirectory()) return dir
    } catch {
      /* keep scanning */
    }
  }
  return null
}

/** Prefer durable activity over creation time when grouping a project's sessions. */
function diskActivityAt(sessionId) {
  const dir = findSessionDir(sessionId)
  if (!dir) return null
  try { return fs.statSync(path.join(dir, 'session.v4.jsonl.zstd')).mtime.toISOString() } catch { return null }
}

/** Read a session's durable log file (zstd JSONL) into plain records. */
function readSessionFile(sessionId) {
  const dir = findSessionDir(sessionId)
  if (dir === null) return []
  let names = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.includes('session') && n.endsWith('.zstd'))
  } catch {
    return []
  }
  for (const name of names) {
    try {
      const raw = fs.readFileSync(path.join(dir, name))
      const text = decompressFrames(raw)
      return text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((record) => record !== null)
    } catch {
      /* try the next candidate */
    }
  }
  return []
}

/**
 * Extract relay context for one DSH session.
 * @param ctx - Host context; `sessionQuery` is optional and probed softly.
 * @param sessionId - Session identity.
 */
export async function extractDshContext(ctx, sessionId) {
  let title = null
  let records = []
  const notes = []

  const query = safeGet(ctx, 'sessionQuery')
  let queryId = sessionId
  let queryHeader = null
  try {
    const list = await query?.listSessions?.()
    const record = list?.find((r) => normalizeId(r.header?.id ?? r.sessionId ?? r.id) === normalizeId(sessionId))
    queryHeader = record?.header ?? record
    queryId = queryHeader?.id ?? record?.sessionId ?? sessionId
  } catch { /* optional metadata */ }
  if (query !== undefined) {
    try {
      const titleValue = await query.readTitle?.(queryId)
      title = titleFrom(titleValue)
    } catch {
      notes.push('readTitle failed')
    }
    try {
      const snapshot = await query.readSession?.(queryId)
      const list = Array.isArray(snapshot) ? snapshot : snapshot?.events
      if (Array.isArray(list)) records = list
      queryHeader = snapshot?.session ?? snapshot?.header ?? queryHeader
    } catch { notes.push('readSession failed') }
    if (records.length === 0) {
      try {
        const events = await query.listEvents?.(queryId)
        const list = Array.isArray(events) ? events : events?.events
        if (Array.isArray(list)) records = list
      } catch { notes.push('listEvents failed') }
    }
  }

  if (records.length === 0) records = readSessionFile(sessionId)

  let harvested = harvest(records)
  if (!harvested.userTexts.length && !harvested.assistantTexts.length) {
    const disk = readSessionFile(sessionId)
    if (disk.length) { records = disk; harvested = harvest(records) }
  }
  const requests = [...new Set(harvested.userTexts.map((text) => pickTaskText([text])).filter(Boolean))]
  const firstUser = requests[0] ?? ''
  const lastAssistant = harvested.assistantTexts.length > 0
    ? harvested.assistantTexts[harvested.assistantTexts.length - 1]
    : ''

  let projectDir = queryHeader?.cwd || records.find((r) => r.type === 'session')?.cwd || records[0]?.header?.cwd || ''
  if (!projectDir) {
    try {
      const sessions = await query?.listSessions?.()
      const record = sessions?.find((r) => normalizeId(r.header?.id ?? r.sessionId ?? r.id) === normalizeId(sessionId))
      projectDir = record?.header?.cwd ?? record?.cwd ?? ''
    } catch { /* disk header is authoritative when query metadata is unavailable */ }
  }
  if (!projectDir || !title) {
    const disk = readSessionFile(sessionId)
    projectDir ||= disk.find((r) => r.type === 'session')?.cwd ?? ''
    title ||= titleFrom(disk.filter((r) => r.type === 'session/title').at(-1)?.data)
  }
  const goal = firstUser
  const progressParts = harvested.assistantTexts.slice(-4)
  return {
    title: title || truncate(firstUser.split('\n')[0] || `DSH session ${sessionId}`, 100),
    projectDir,
    goal,
    messages: harvested.messages,
    userTexts: harvested.userTexts,
    assistantTexts: harvested.assistantTexts,
    sourceFile: findSessionDir(sessionId) ? path.join(findSessionDir(sessionId), 'session.v4.jsonl.zstd') : null,
    recentRequests: requests.slice(1).slice(-4),
    progress: progressParts.join('\n\n'),
    keyFiles: harvested.filePaths.slice(0, 40),
    tools: harvested.toolNames.slice(0, 30),
    userMessageCount: harvested.userTexts.length,
    assistantMessageCount: harvested.assistantTexts.length,
    lastAssistant: truncate(lastAssistant, 1200),
    fromSessionId: sessionId,
    notes,
  }
}

function safeGet(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

/**
 * List DSH sessions that have not been turned into relay tasks yet.
 * Primary: `sessionQuery.listSessions()`. Fallback: the on-disk session
 * directories (workspace-group + session-uuid + mtime) when the service is
 * unavailable. Session ids are normalized (no `session-` prefix) so they
 * compare cleanly with task sources.
 */
export async function listDshSessions(ctx, excludeSessionIds = new Set()) {
  const rows = []
  const excluded = new Set([...excludeSessionIds].map(normalizeId))
  const query = safeGet(ctx, 'sessionQuery')
  let querySucceeded = false
  if (typeof query?.listSessions === 'function') {
    try {
      const records = await query.listSessions()
      if (!Array.isArray(records)) throw new Error('Unexpected session list')
      querySucceeded = true
      for (const record of records) {
        const header = record.header ?? record
        if (isDelegated(header)) continue
        const sessionId = normalizeId(header.id ?? record.sessionId ?? record.id)
        if (!sessionId || excluded.has(sessionId)) continue
        let title = titleFrom(record.title ?? header.title ?? record.projections?.values?.title)
        if (!title) {
          try { title = titleFrom(await query.readTitle?.(header.id ?? sessionId)) } catch { /* use fallback */ }
        }
        rows.push({
          sessionId,
          title: title || `DSH ${sessionId.slice(0, 8)}`,
          projectDir: header.cwd ?? record.cwd ?? record.workspaceRoot ?? '',
          lastActivity: record.updatedAt ?? record.lastActivity ?? record.modifiedAt ?? header.updatedAt ?? diskActivityAt(sessionId) ?? header.createdAt ?? null,
        })
      }
    } catch { /* scan durable logs when the service is unavailable */ }
  }
  if (!querySucceeded) {
    const base = path.join(homeDir(), '.dsh', 'sessions')
    let groups = []
    try { groups = fs.readdirSync(base) } catch { return [] }
    for (const group of groups) {
      let sessions = []
      try { sessions = fs.readdirSync(path.join(base, group)) } catch { continue }
      for (const entry of sessions) {
        if (!entry.startsWith('session-')) continue
        const sessionId = normalizeId(entry)
        if (excluded.has(sessionId)) continue
        const dir = path.join(base, group, entry)
        let stat
        try { stat = fs.statSync(path.join(dir, 'session.v4.jsonl.zstd')) } catch { continue }
        const header = diskHeader(path.join(dir, 'session.v4.jsonl.zstd'))
        if (isDelegated(header)) continue
        let cached = diskMetadata.get(dir)
        if (!cached || cached.mtimeMs !== stat.mtimeMs) {
          const records = readSessionFile(sessionId)
          const fullHeader = header ?? records.find((r) => r.type === 'session')
          const titleEvent = records.filter((r) => r.type === 'session/title').at(-1)
          const first = harvest(records).userTexts.find((text) => !/^<|^# AGENTS|^You are /.test(text))
          cached = {
            mtimeMs: stat.mtimeMs,
            title: titleFrom(titleEvent?.data) || first?.split('\n')[0]?.slice(0, 120) || `DSH ${sessionId.slice(0, 8)}`,
            // Never guess an actual filesystem path from a lossy folder encoding.
            projectDir: fullHeader?.cwd ?? '',
          }
          diskMetadata.set(dir, cached)
        }
        rows.push({ sessionId, title: cached.title, projectDir: cached.projectDir, lastActivity: stat.mtime.toISOString() })
      }
    }
  }
  rows.sort((a, b) => String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? '')))
  const unique = new Map()
  for (const row of rows) if (!unique.has(row.sessionId)) unique.set(row.sessionId, row)
  return [...unique.values()]
}

const diskMetadata = new Map()
