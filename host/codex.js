/**
 * Codex side adapter: rollout JSONL scanning and parsing, plus the latest
 * rate-limit snapshot.
 *
 * Format note: ~/.codex/sessions/... /rollout-*.jsonl is Codex's own local
 * record (session_meta + response_item/event_msg/token_count records). It is
 * not a published contract, so everything here parses by shape with per-line
 * try/catch and degrades to "meta only" instead of failing. Archived sessions
 * (*.jsonl.zst) are skipped on runtimes without a zstd decoder.
 */
import fs from 'node:fs'
import path from 'node:path'
import { decompressFrames } from './zstd.js'
import { fileIdentity } from './identity.js'
import { homeDir } from './util.js'

export function codexHome() {
  return path.join(homeDir(), '.codex')
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
      scored.push({ file, mtimeMs: stat.mtimeMs, size: stat.size })
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
    if (size > headBytes) {
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

/** Pull user/assistant texts and tool activity out of parsed rollout records. */
function harvestRollout(records) {
  const userTexts = []
  const assistantTexts = []
  const messages = []
  const toolPaths = new Set()
  const toolNames = new Set()
  let meta = null
  let tokens = null
  let running = null

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
      if (innerType === 'task_started') running = true
      if (['task_complete','task_completed','turn_aborted','task_failed'].includes(innerType)) running = false
      if (innerType === 'user_message' || innerType === 'agent_message') {
        collectMessage({ role: innerType === 'user_message' ? 'user' : 'assistant', message: payload.message }, record)
      }
    } else if (type === 'message') collectMessage(payload, record)

    if (type === 'token_count' || type === 'token_usage_record') tokens = payload
  }

  return { meta, userTexts, assistantTexts, messages, running, toolPaths: [...toolPaths], toolNames: [...toolNames], tokens }
}

/** Parse one rollout file fully (import path). */
export function parseRollout(file) {
  let text
  try {
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
  return {
    file,
    sessionId: meta.session_id ?? meta.id ?? null,
    projectDir: meta.cwd ?? null,
    originator: meta.originator ?? null,
    cliVersion: meta.cli_version ?? null,
    createdAt: meta.timestamp ?? null,
    userTexts: harvested.userTexts,
    messages: harvested.messages,
    running: harvested.running,
    assistantTexts: harvested.assistantTexts,
    toolPaths: harvested.toolPaths,
    toolNames: harvested.toolNames,
    tokens: harvested.tokens,
  }
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

/** Summarize recent Codex threads for the import list. */
export function listCodexThreads(limit = 20) {
  const threads = []
  const seenSessions = new Set()
  for (const entry of listRolloutFiles(limit * 6)) {
    if (threads.length >= limit) break
    if (entry.file.endsWith('.zst')) continue
    const { head, tail } = readHeadTail(entry.file)
    const headRecords = parseLines(head)
    const tailRecords = parseLines(tail)
    const harvested = harvestRollout([...headRecords, ...tailRecords])
    const meta = harvested.meta ?? {}
    const sessionId = meta.session_id ?? meta.id ?? null
    if (!sessionId || seenSessions.has(sessionId)) continue
    const taskText = pickTaskText(harvested.userTexts)
    if (!taskText) continue
    const title = taskTitle(taskText)
    if (INTERNAL_TITLE.test(title) || INSTRUCTION_TEXT.test(title)) continue
    if (typeof sessionId === 'string') seenSessions.add(sessionId)
    const lastAssistant = harvested.assistantTexts.length > 0
      ? harvested.assistantTexts[harvested.assistantTexts.length - 1]
      : ''
    threads.push({
      file: entry.file,
      sessionId,
      projectDir: meta.cwd ?? '',
      title,
      lastActivity: new Date(entry.mtimeMs).toISOString(),
      originator: meta.originator ?? null,
      lastAssistant: typeof lastAssistant === 'string' ? lastAssistant.slice(0, 600) : '',
    })
  }
  return threads
}

/** Associate a run only with its exact thread and project, never another active client. */
export function findRunSessionFile(sinceMs, expected = {}) {
  if (!expected.sessionId) return null
  for (const entry of listRolloutFiles(200)) {
    if (entry.file.endsWith('.zst') || entry.mtimeMs < sinceMs - 5000) continue
    const { head } = readHeadTail(entry.file)
    const meta = parseLines(head).find((record) => record.type === 'session_meta')?.payload
    if ((meta?.session_id ?? meta?.id) !== expected.sessionId) continue
    if (expected.projectDir && fileIdentity(meta?.cwd) !== fileIdentity(expected.projectDir)) continue
    return entry
  }
  return null
}
