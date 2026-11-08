/** Stable project records and durable single-writer leases, independent of card labels. */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { storeRoot, loadAllTasks, loadTask } from './store.js'
import { fileIdentity } from './identity.js'
import { digest } from './workspace.js'

function directory(name) { const dir = path.join(storeRoot(), name); fs.mkdirSync(dir, { recursive: true }); return dir }
function write(file, value) { const tmp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file) }
export function listProjects() {
  return fs.readdirSync(directory('projects')).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try { return [JSON.parse(fs.readFileSync(path.join(directory('projects'), name), 'utf8'))] } catch { return [] }
  })
}
export function saveProject(project) { project.updatedAt = new Date().toISOString(); write(path.join(directory('projects'), `${project.id}.json`), project); return project }
export function resolveProject(projectDir) {
  const cwd = fileIdentity(projectDir)
  if (!cwd) throw new Error('项目目录缺失')
  const found = listProjects().find((project) => project.directories.includes(cwd))
  if (found) return found
  return saveProject({ id: `project-${randomUUID()}`, name: path.basename(cwd), directories: [cwd], primaryDir: cwd, goal: '', constraints: [], decisions: [], verify: [], notes: '', requirements: [], sessions: {}, createdAt: new Date().toISOString() })
}
export function readProject(id) { return listProjects().find((project) => project.id === id) ?? null }
export function updateProject(id, patch) {
  const project = readProject(id)
  if (!project) throw new Error('project not found')
  for (const key of ['goal', 'notes']) if (typeof patch[key] === 'string') project[key] = patch[key]
  if (typeof patch.goal === 'string') project.goalConfirmed = true
  for (const key of ['constraints', 'decisions', 'verify']) {
    if (Array.isArray(patch[key])) project[key] = patch[key].filter((text) => typeof text === 'string' && text.trim()).map((text) => text.trim())
  }
  if (patch.directory) {
    const cwd = fileIdentity(patch.directory)
    if (!fs.statSync(cwd).isDirectory()) throw new Error('迁移目标目录不存在')
    if (listProjects().some((other) => other.id !== id && other.directories.includes(cwd))) throw new Error('该目录已属于另一个项目')
    project.directories = [...new Set([...project.directories, cwd])]
    project.primaryDir = cwd
  }
  project.masterRevision = (project.masterRevision ?? 0) + 1
  return saveProject(project)
}
export function sameProject(task, project) {
  return task.projectId === project.id || project.directories.includes(fileIdentity(task.projectDir))
}
export function projectTask(project) {
  const rank = { executing: 5, preparing: 5, staged: 4, 'awaiting-review': 3, failed: 2, done: 1 }
  return loadAllTasks().filter((task) => sameProject(task, project))
    .sort((a,b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null
}
function lockPath(projectId) { return path.join(directory('locks'), `${digest(projectId)}.json`) }
function pidAlive(pid) { try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' } }
export function acquireProject(project, taskId, revision, target) {
  const file = lockPath(project.id)
  const lease = { taskId, revision, target, projectId: project.id, nonce: randomUUID(), hostPid: process.pid, acquiredAt: new Date().toISOString() }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600)
      try { fs.writeFileSync(fd, JSON.stringify(lease)) } finally { fs.closeSync(fd) }
      return lease
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let old
      try { old = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw new Error('项目执行锁损坏，需要检查后恢复') }
      const owner = loadTask(old.taskId)
      // A live host may still be in the gap between acquiring and saving its preparing state.
      if (pidAlive(old.hostPid) || (owner && ['executing','preparing'].includes(owner.status))) throw new Error('该项目已有一方正在执行，请先等待本轮结束')
      fs.unlinkSync(file)
    }
  }
  throw new Error('项目执行锁获取失败')
}
export function releaseProject(projectId, lease) {
  if (!lease) return
  const file = lockPath(projectId)
  try {
    const current = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (current.nonce === lease.nonce) fs.unlinkSync(file)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
export function activeProjectTask(project, exceptId) {
  return loadAllTasks().find((task) => task.id !== exceptId && sameProject(task, project) && ['executing','preparing'].includes(task.status))
}
