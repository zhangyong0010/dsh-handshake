/**
 * Durable relay-task store. One JSON file per task under ~/.dsh-handshake/tasks,
 * plus an index.json of summaries. Writes are atomic (tmp + rename); the task
 * file is authoritative and the index is a derived cache that is rebuilt when
 * missing or inconsistent.
 */
import fs from 'node:fs'
import path from 'node:path'
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

function indexPath() {
  return path.join(storeRoot(), 'index.json')
}

export function ensureStore() {
  fs.mkdirSync(tasksDir(), { recursive: true })
  fs.mkdirSync(runsDir(), { recursive: true })
  return storeRoot()
}

export function runLogPath(taskId) {
  ensureStore()
  return path.join(runsDir(), `${taskId}.log`)
}

function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
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
  ensureStore()
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

/** Load every task, newest activity first. Rebuilds from files on any miss. */
export function loadAllTasks() {
  ensureStore()
  const tasks = []
  let names = []
  try {
    names = fs.readdirSync(tasksDir()).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  for (const name of names) {
    try {
      const task = JSON.parse(fs.readFileSync(path.join(tasksDir(), name), 'utf8'))
      if (task && typeof task.id === 'string') tasks.push(task)
    } catch {
      /* skip a corrupt file rather than losing the board */
    }
  }
  tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return tasks
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
    relayCount: Array.isArray(task.relay) ? task.relay.length : 0,
    lastRelay: Array.isArray(task.relay) && task.relay.length > 0 ? task.relay[task.relay.length - 1] : null,
    edit: task.edit,
    error: task.error ?? null,
    executing: task.status === 'executing',
  }
}
