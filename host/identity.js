import fs from 'node:fs'
import path from 'node:path'

export const sessionId = (value) => String(value ?? '').trim().replace(/^session-/, '')

export function fileIdentity(file) {
  if (!file) return ''
  try { return fs.realpathSync(file) } catch { return path.resolve(file) }
}

export function sourceKey(source) {
  if (source?.kind === 'dsh' && sessionId(source.sessionId)) return `dsh:${sessionId(source.sessionId)}`
  if (source?.kind === 'codex') {
    if (sessionId(source.codexSessionId)) return `codex:${sessionId(source.codexSessionId)}`
    if (source.rolloutFile) return `file:${fileIdentity(source.rolloutFile)}`
  }
  return null
}

/** The board treats a named project (including relocated copies) as one unit. */
export function projectKey(projectDir) {
  if (typeof projectDir !== 'string' || !projectDir.trim()) return null
  const directory = fileIdentity(projectDir).replace(/\/+$/, '')
  return (path.basename(directory) || directory || '/').normalize('NFC').toLowerCase()
}

export function projectSourceKey(kind, projectDir) {
  const key = projectKey(projectDir)
  return key && kind ? `${kind}:project:${key}` : null
}

function activityTime(value) {
  const time = typeof value === 'number' || /^\d+$/.test(String(value ?? ''))
    ? Number(value) : Date.parse(value ?? '')
  return Number.isFinite(time) ? time : 0
}

/** One project card per column; its action targets the latest main session. */
export function groupProjects(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = row.projectId ?? projectKey(row.projectDir) ?? `session:${sessionId(row.sessionId) || fileIdentity(row.file)}`
    const id = sessionId(row.sessionId) || fileIdentity(row.file)
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { item: row, ids: new Set([id]) })
      continue
    }
    group.ids.add(id)
    if (activityTime(row.lastActivity) > activityTime(group.item.lastActivity)) group.item = row
  }
  return [...groups.entries()]
    .map(([key, { item, ids }]) => ({ ...item, projectKey: key, sessionCount: ids.size }))
    .sort((a, b) => activityTime(b.lastActivity) - activityTime(a.lastActivity))
}

// Prefer a running task when older releases have already written duplicates.
// Keep every original JSON file; deduplication is a view, not a data migration.
export function uniqueTasks(tasks, keyForTask = (task) => sourceKey(task.source)) {
  const rank = { executing: 4, 'awaiting-review': 3, staged: 2, failed: 1, done: 0 }
  const selected = new Map()
  for (const task of tasks) {
    const key = keyForTask(task) ?? `task:${task.id}`
    const previous = selected.get(key)
    if (!previous || (rank[task.status] ?? 0) > (rank[previous.status] ?? 0)
      || (rank[task.status] === rank[previous.status] && activityTime(task.updatedAt) > activityTime(previous.updatedAt))) selected.set(key, task)
  }
  return [...selected.values()]
}

export const uniqueProjectTasks = (tasks) => uniqueTasks(tasks,
  (task) => projectSourceKey(task.source?.kind, task.projectDir) ?? sourceKey(task.source))
