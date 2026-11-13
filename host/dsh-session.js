import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { decompressFrames } from './zstd.js'
import { sessionId as normalizeId } from './identity.js'
import { pickTaskText } from './codex.js'
import { homeDir, withDeadline } from './util.js'

const isDelegated = (header) => header?.origin === 'subagent' || Number(header?.delegationDepth) > 0

function diskHeader(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 256 * 1024))
    fs.readSync(fd, buffer, 0, buffer.length, 0)
    // The first independent frame holds the header; no body scan is needed here.
    return JSON.parse(zlib.zstdDecompressSync(buffer).toString('utf8').split('\n')[0])
  } catch { return null } finally { if (fd !== undefined) fs.closeSync(fd) }
}

export function harvest(records) {
  const userTexts = []
  const assistantTexts = []
  const messages = []
  let currentRecord = null
  const toolNames = new Set()
  const filePaths = new Set()

  const pathKey = /^(path|file_?path|filepath|filename)$/i
  const textKey = /^(text|input_text|output_text|content_?text)$/i

  const visit = (value, role, depth, includeText = true) => {
    if (value === null || value === undefined || depth > 24) return
    if (typeof value === 'string') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, role, depth + 1, includeText)
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
        else if (includeText && textKey.test(key) && child.trim() !== '') {
          const text = child.trim()
          if (nextRole === 'user') {
            if (pickTaskText([text])) { userTexts.push(text); messages.push({ role: 'user', text, seq: currentRecord?.seq ?? messages.length, at: currentRecord?.time ?? currentRecord?.timestamp ?? null }) }
          } else if (nextRole === 'assistant') {
            assistantTexts.push(text); messages.push({ role: 'assistant', text, seq: currentRecord?.seq ?? messages.length, at: currentRecord?.time ?? currentRecord?.timestamp ?? null })
          }
        }
      } else {
        visit(child, nextRole, depth + 1, includeText)
      }
    }
  }

  const authored = (record) => ['user/message','assistant/message'].includes(record?.type)
  const hasCanonical = Array.isArray(records) && records.some(authored)
  for (const record of Array.isArray(records) ? records : [records]) {
    currentRecord = record
    visit(record, null, 0, !hasCanonical || authored(record))
  }
  return { userTexts, assistantTexts, messages, toolNames: [...toolNames], filePaths: [...filePaths] }
}

function looksLikePath(value) {
  if (value.length < 2 || value.length > 512) return false
  if (/[\n\r]/.test(value)) return false
  return /^(\/|~\/|\.{1,2}\/)/.test(value) || /^[A-Za-z]:[\\/]/.test(value)
}

function titleFrom(value, depth = 0) {
  if (depth > 8) return null
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object') {
    for (const key of ['title', 'text', 'value', 'displayTitle']) {
      const found = titleFrom(value[key], depth + 1)
      if (found) return found
    }
  }
  return null
}

function truncate(text, max) {
  const s = String(text ?? '').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function findSessionDir(sessionId) {
  if (!/^[a-z0-9_-]+$/i.test(sessionId)) return null
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
function diskActivityAt(dir) {
  if (!dir) return null
  try { return fs.statSync(path.join(dir, 'session.v4.jsonl.zstd')).mtime.toISOString() } catch { return null }
}

/** Read a session's durable log file (zstd JSONL) into plain records. */
function readSessionFile(dir) {
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

export async function readDshRunEvents(ctx, id) {
  if (!id) return null
  const query = safeGet(ctx, 'sessionQuery')
  for (const candidate of new Set([id, `session-${normalizeId(id)}`])) {
    try {
      const snapshot = await withDeadline(() => query?.readSession?.(candidate))
      const events = Array.isArray(snapshot) ? snapshot : snapshot?.events
      if (Array.isArray(events)) return events
    } catch { /* try the durable session record */ }
  }
  const events = readSessionFile(findSessionDir(normalizeId(id)))
  return events.length ? events : null
}

export function observeDshRequest(events, requestId, baselineSeq) {
  if (!requestId) return { receipt: false, turn: null, finish: null, evidence: [] }
  let openTurn = null, matchedTurn = null, receipt = false, finish = null
  const evidence = []
  for (const event of events ?? []) {
    if (!Number.isSafeInteger(event?.seq) || (baselineSeq !== null && baselineSeq !== undefined && event.seq <= baselineSeq)) continue
    if (event.type === 'turn/start') openTurn = event.data?.turn ?? null
    if (event.type === 'user/message' && event.data?.source?.kind === 'user' && event.data.source.rpcId === requestId && openTurn !== null) {
      receipt = true
      matchedTurn = openTurn
      evidence.length = 0
      finish = null
    }
    if (matchedTurn === null || openTurn !== matchedTurn) continue
    evidence.push(event)
    if (event.type === 'turn/end' && event.data?.turn === matchedTurn) {
      finish = event.data.reason ?? null
      openTurn = null
    }
  }
  return { receipt, turn: matchedTurn, finish, evidence }
}

export async function extractDshContext(ctx, sessionId) {
  const query = safeGet(ctx, 'sessionQuery')
  const candidates = new Set([`session-${sessionId}`, sessionId])
  let header, records, queryId
  for (const id of candidates) {
    try {
      const snapshot = await withDeadline(() => query?.readSession?.(id))
      const found = snapshot?.session ?? snapshot?.header
      if (found?.id && normalizeId(found.id) !== sessionId) continue
      const events = Array.isArray(snapshot) ? snapshot : snapshot?.events
      if (!found && !Array.isArray(events)) continue
      header = found
      records = events
      queryId = found?.id ?? id
      break
    } catch { /* try the other ID form */ }
  }

  let dir = null
  let disk
  const readDisk = () => {
    if (!disk) {
      dir = findSessionDir(sessionId)
      disk = readSessionFile(dir)
    }
    return disk
  }
  if (!records?.length) {
    try {
      const response = await withDeadline(() => query?.listEvents?.(queryId ?? `session-${sessionId}`))
      records = Array.isArray(response) ? response : response?.events
    } catch { /* fall back to disk */ }
  }
  records = records?.length ? records : readDisk()
  let harvested = harvest(records)
  if (!harvested.messages.length && records !== disk) {
    const fallback = readDisk()
    if (fallback.length) { records = fallback; harvested = harvest(records) }
  }

  let projectDir = header?.cwd ?? records.find((record) => record?.type === 'session')?.cwd ?? records[0]?.header?.cwd
  let title = titleFrom(header?.title)
  if (!projectDir) {
    try {
      const list = await withDeadline(() => query?.listSessions?.())
      const record = list?.find((row) => normalizeId(row?.header?.id ?? row?.sessionId ?? row?.id) === sessionId)
      projectDir = record?.header?.cwd ?? record?.cwd
      title ??= titleFrom(record?.title ?? record?.header?.title)
      queryId ??= record?.header?.id ?? record?.sessionId ?? record?.id
    } catch { /* fall back to disk */ }
  }
  if (!title) {
    try { title = titleFrom(await withDeadline(() => query?.readTitle?.(queryId ?? `session-${sessionId}`),1500)) } catch { /* title is optional */ }
  }
  if (!projectDir || !title) {
    const fallback = readDisk()
    projectDir ||= fallback.find((record) => record?.type === 'session')?.cwd
    title ||= titleFrom(fallback.findLast((record) => record?.type === 'session/title')?.data)
  }
  const goal = pickTaskText(harvested.userTexts)
  return {
    title: title || truncate(goal.split('\n')[0] || `DSH session ${sessionId}`, 100),
    projectDir, goal, messages:harvested.messages,
    progress:harvested.assistantTexts.slice(-4).join('\n\n'),
    sourceFile:dir ? path.join(dir,'session.v4.jsonl.zstd') : null,
  }
}

function safeGet(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

export function dshProjectNames(ctx) {
  const registry = safeGet(ctx, 'workspaceRegistry')
  let workspaces = []
  try { workspaces = registry?.list?.() ?? [] } catch { /* optional on older hosts */ }
  const membership = new Map()
  const projects = []
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    const name = typeof workspace.title === 'string' && workspace.title.trim()
    if (!name || typeof workspace.path !== 'string') continue
    projects.push({ name, roots: [workspace.path] })
    for (const id of workspace.sessionIds ?? []) membership.set(normalizeId(id), name)
  }
  return { projects, forSession: (id) => membership.get(normalizeId(id)) ?? null }
}

const titlesByQuery = new WeakMap()
export async function listDshSessions(ctx, excludeSessionIds = new Set()) {
  const rows = []
  const excluded = new Set([...excludeSessionIds].map(normalizeId))
  const query = safeGet(ctx, 'sessionQuery')
  let querySucceeded = false
  if (typeof query?.listSessions === 'function') {
    try {
      const records = await withDeadline(() => query.listSessions())
      if (!Array.isArray(records)) throw new Error('Unexpected session list')
      const catalog = records.flatMap((record) => {
        const header = record?.header ?? record
        if (!header || isDelegated(header)) return []
        const id = header.id ?? record.sessionId ?? record.id
        const sessionId = normalizeId(id)
        if (!sessionId || excluded.has(sessionId)) return []
        return [{ id, sessionId, header, record }]
      })
      const previousTitles = titlesByQuery.get(query) ?? new Map()
      const titles = new Map()
      titlesByQuery.set(query,titles)
      const titleDeadline = Date.now() + 2000
      for (let offset = 0; offset < catalog.length; offset += 8) {
        const batch = await Promise.all(catalog.slice(offset,offset + 8).map(async ({ id, sessionId, header, record }) => {
          const lastActivity = record.updatedAt ?? record.lastActivity ?? record.modifiedAt ?? header.updatedAt ??
            diskActivityAt(findSessionDir(sessionId)) ?? header.createdAt ?? null
          let title = titleFrom(record.title ?? header.title ?? record.projections?.values?.title)
          const previous = previousTitles.get(id)
          if (!title && lastActivity && previous?.lastActivity === lastActivity && previous.until > Date.now()) {
            title = previous.title
            titles.set(id,previous)
          } else if (!title) {
            const remaining = titleDeadline - Date.now()
            if (remaining > 0) {
              try { title = titleFrom(await withDeadline(() => query.readTitle?.(id),Math.min(500,remaining))) } catch { /* title is optional */ }
            }
            if (title && lastActivity) titles.set(id,{title,lastActivity,until:Date.now()+60000})
          }
          return {
            sessionId, title:title || `DSH ${sessionId.slice(0,8)}`, lastActivity,
            projectDir:header.cwd ?? record.cwd ?? record.workspaceRoot ?? '',
          }
        }))
        rows.push(...batch)
      }
      querySucceeded = true
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
        let cached = diskMetadata.get(dir)
        const stamp = [stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':')
        if (cached?.stamp !== stamp) {
          const header = diskHeader(path.join(dir, 'session.v4.jsonl.zstd'))
          if (isDelegated(header)) continue
          const records = readSessionFile(dir)
          const fullHeader = header ?? records.find((r) => r.type === 'session')
          if (isDelegated(fullHeader)) continue
          const titleEvent = records.filter((r) => r.type === 'session/title').at(-1)
          const first = harvest(records).userTexts.find((text) => !/^<|^# AGENTS|^You are /.test(text))
          cached = {
            stamp,
            title: titleFrom(titleEvent?.data) || first?.split('\n')[0]?.slice(0, 120) || `DSH ${sessionId.slice(0, 8)}`,
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
