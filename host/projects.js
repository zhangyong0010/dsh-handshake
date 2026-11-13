import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { storeRoot, loadTaskViews, loadTask } from './store.js'
import { fileIdentity, sourceKey } from './identity.js'
import { digest, gitCommonDir } from './workspace.js'

function directory(name) { const dir = path.join(storeRoot(), name); fs.mkdirSync(dir, { recursive: true }); return dir }
function write(file, value) { const tmp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file) }
const projectFile = (id) => path.join(storeRoot(),'projects',`${id}.json`)
function readProjectFile(file) {
  try {
    const project = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof project?.id === 'string' && Array.isArray(project.directories) ? project : null
  } catch { return null }
}
export function listProjects() {
  return fs.readdirSync(directory('projects')).filter((name) => name.endsWith('.json'))
    .map((name) => readProjectFile(path.join(storeRoot(),'projects',name))).filter(Boolean)
}
export function saveProject(project) { project.updatedAt = new Date().toISOString(); write(path.join(directory('projects'), `${project.id}.json`), project); return project }
export function resolveProject(projectDir, projects = listProjects(), commonDir = gitCommonDir) {
  const cwd = fileIdentity(projectDir)
  if (!cwd) throw new Error('项目目录缺失')
  const exact = projects.find((project) => project.directories.includes(cwd))
  const common = commonDir(cwd)
  if (exact) {
    if (common && !exact.gitCommonDirs?.includes(common)) {
      exact.gitCommonDirs = [...(exact.gitCommonDirs ?? []), common]
      return saveProject(exact)
    }
    return exact
  }
  const found = common && (projects.find((project) => project.gitCommonDirs?.includes(common)) ??
    projects.find((project) => project.directories.some((dir) => commonDir(dir) === common)))
  if (found) {
    found.directories.push(cwd)
    found.gitCommonDirs = [...new Set([...(found.gitCommonDirs ?? []), common])]
    return saveProject(found)
  }
  const project = saveProject({ id: `project-${randomUUID()}`, name: path.basename(cwd), directories: [cwd], primaryDir: cwd, gitCommonDirs: common ? [common] : [], goal: '', constraints: [], decisions: [], verify: [], notes: '', requirements: [], sessions: {}, createdAt: new Date().toISOString() })
  projects.push(project)
  return project
}
export function readProject(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id) ? readProjectFile(projectFile(id)) : null
}
export function updateProject(id, patch) {
  const project = readProject(id)
  if (!project) throw new Error('project not found')
  if (typeof patch.goal === 'string' && patch.goal.trim() !== (project.goal ?? '').trim()) {
    project.goal = patch.goal.trim()
    project.goalConfirmed = Boolean(project.goal)
  }
  if (typeof patch.notes === 'string') project.notes = patch.notes
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
export function matchesTaskSession(task, source, cwd) {
  const key = sourceKey(source)
  if (!key || fileIdentity(task.projectDir) !== fileIdentity(cwd)) return false
  const linked = { kind: source.kind, codexSessionId: task.links?.codexSessionId, dshSessionId: task.links?.dshSessionId }
  if (source.kind === 'dsh') linked.sessionId = linked.dshSessionId
  return [task.source, linked].some((item) => sourceKey(item) === key)
}
export const isActiveTask = (task) => ['preparing', 'executing', 'unknown'].includes(task?.status)
function lockPath(projectId) { return path.join(directory('locks'), `${digest(projectId)}.json`) }
function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}
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
      if (pidAlive(old.hostPid) || isActiveTask(owner)) throw new Error('该项目已有一方正在执行，请先等待本轮结束')
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
  return loadTaskViews().find((task) => task.id !== exceptId && isActiveTask(task) && sameProject(task, project))
}
