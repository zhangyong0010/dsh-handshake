import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { homeDir } from './util.js'

export const TASK_SCHEMA = 'dsh-handshake/task@1'

export function storeRoot() {
  return path.join(homeDir(), '.dsh-handshake')
}

function tasksDir() {
  return path.join(storeRoot(), 'tasks')
}

function runsDir() {
  return path.join(storeRoot(), 'runs')
}

export function ensureStore() {
  fs.mkdirSync(storeRoot(), { recursive: true, mode: 0o700 })
  fs.mkdirSync(tasksDir(), { recursive: true, mode: 0o700 })
  fs.mkdirSync(runsDir(), { recursive: true, mode: 0o700 })
  return storeRoot()
}

export function runLogPath(taskId) {
  ensureStore()
  return path.join(runsDir(), `${taskId}.log`)
}

function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${randomUUID()}`
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function newTaskId() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 6)
  return `hs-${stamp}-${rand}`
}

export function createTask(fields, { persist = true } = {}) {
  const now = new Date().toISOString()
  const task = {
    schema: TASK_SCHEMA,
    id: fields.id ?? newTaskId(),
    title: fields.title ?? 'Untitled task',
    status: 'staged',
    owner: 'none',
    projectDir: fields.projectDir ?? '',
    createdAt: now,
    updatedAt: now,
    source: fields.source ?? { kind: 'dsh' },
    packet: fields.packet ?? null,
    relay: [],
    edit: {
      lastEditor: null,
      lastEditAt: null,
      dsh: { files: 0, lastAt: null, fileList: [] },
      codex: { files: 0, lastAt: null, fileList: [] },
    },
    execution: null,
    error: null,
  }
  if (persist) saveTask(task)
  return task
}

export function taskFile(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id)) throw new Error('invalid task ID')
  return path.join(tasksDir(), `${id}.json`)
}

export function loadTask(id) {
  try {
    return JSON.parse(fs.readFileSync(taskFile(id), 'utf8'))
  } catch {
    return null
  }
}

export function saveTask(task) {
  ensureStore()
  task.updatedAt = new Date().toISOString()
  atomicWrite(taskFile(task.id), JSON.stringify(task, null, 2))
  return task
}

export function deleteTask(id) {
  try {
    fs.unlinkSync(taskFile(id))
    return true
  } catch {
    return false
  }
}

export function addRelay(task, entry) {
  task.relay.push({ at: new Date().toISOString(), ...entry })
  return task
}

const taskViews = new Map()
function listTasks(project) {
  const tasks = []
  const dir = tasksDir()
  let names
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    if (project) taskViews.clear()
    return []
  }
  const files = project && new Set(names.map((name) => path.join(dir, name)))
  if (files) for (const file of taskViews.keys()) if (!files.has(file)) taskViews.delete(file)
  for (const name of names) {
    const file = path.join(dir, name)
    try {
      const stat = project && fs.statSync(file)
      const key = stat && [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
      const saved = project && taskViews.get(file)
      if (saved && saved.key === key) {
        tasks.push(saved.view)
        continue
      }
      const task = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (typeof task?.id !== 'string') continue
      const view = project ? project(task) : task
      if (project) taskViews.set(file, { key, view })
      tasks.push(view)
    } catch {
      if (project) taskViews.delete(file)
    }
  }
  tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return tasks
}
export function loadAllTasks() { return listTasks() }
export function loadTaskViews() {
  return listTasks((task) => ({
    id:task.id, title:task.title, status:task.status, projectId:task.projectId, projectDir:task.projectDir, updatedAt:task.updatedAt,
    archivedAt:task.archivedAt, restoredAt:task.restoredAt, source:task.source, links:task.links, execution:task.execution,
    rounds:task.rounds?.map((round) => ({ source:round.source, execution:round.execution && {
      codexSessionId:round.execution.codexSessionId, dshSessionId:round.execution.dshSessionId,
    } })),
    packet:task.packet && { schema:task.packet.schema, executionPlan:task.packet.executionPlan, receiptPath:task.packet.receiptPath, revision:task.packet.revision,
      digest:task.packet.digest, projectId:task.packet.projectId, workspace:{ digest:task.packet.workspace?.digest },
      references:task.packet.references?.filter((reference) => reference.required) },
    summary:taskSummary(task),
  }))
}

export function taskSummary(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    owner: task.owner,
    projectDir: task.projectDir,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    sourceKind: task.source?.kind ?? null,
    projectId: task.projectId ?? null,
    revision: task.revision ?? 0,
    target: task.target ?? (task.source?.kind === 'codex' ? 'dsh' : 'codex'),
    lastExecutedBy: task.lastExecutedBy ?? null,
    reception: task.reception ?? null,
    preflight: task.preflight ?? null,
    verification: task.verification ?? null,
    contextCoverage: task.packet?.coverage ?? null,
    protocol: task.packet?.schema ?? null,
    runId: task.execution?.runId ?? null,
    packetDigest: task.packet?.digest ?? null,
    archivedAt: task.archivedAt ?? null,
    targetSession: task.packet?.executionPlan?.targetSession ?? null,
    failureCode: task.execution?.failureCode ?? null,
    brief: task.packet?.brief ? { goal: task.packet.brief.goal, latestRequest: task.packet.brief.latestRequest, latestSourceId:task.packet.brief.latestSource?.id ?? null,
      clarification: task.packet.brief.clarification ?? null, clarificationScope: task.packet.brief.clarificationScope ?? null,
      inheritedNotes: task.packet.brief.inheritedNotes ?? [], explicitRules: task.packet.brief.explicitRules ?? [], acceptance: task.packet.brief.acceptance ?? [],
      recentConstraints: task.packet.brief.recentConstraints ?? [], suggestedAcceptance: task.packet.brief.suggestedAcceptance ?? [],
      nextStep: task.packet.brief.nextStep ?? null, remaining: task.packet.brief.remaining ?? [], mode: task.packet.executionPlan?.mode } : null,
    result: task.result ?? null,
    relayCount: Array.isArray(task.relay) ? task.relay.length : 0,
    lastRelay: Array.isArray(task.relay) && task.relay.length > 0 ? task.relay[task.relay.length - 1] : null,
    edit: task.edit,
    error: task.error ?? null,
    executing: task.status === 'executing',
  }
}
