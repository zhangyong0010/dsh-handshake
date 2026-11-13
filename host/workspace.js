import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileIdentity } from './identity.js'

export const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
const OMIT = new Set(['.git', 'node_modules', '.backups', '.dsh-handshake', '.codex', '.agents', 'dist', 'build', '.next', '.venv', 'vendor'])
export function hashFile(file) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let count
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count))
    return hash.digest('hex')
  } finally { fs.closeSync(fd) }
}
const git = (cwd, args) => {
  const result = spawnSync('/usr/bin/git', ['--no-optional-locks','-C', cwd, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 })
  return result.status === 0 ? result.stdout : null
}
export function changesBetweenCommits(cwd, root, before, after) {
  if (!before || !after || before === after) return []
  if (!root || ![before, after].every((id) => /^[a-f0-9]{40,64}$/.test(id))) return null
  const files = git(root, ['diff', '--name-only', '--no-renames', '-z', before, after, '--'])
  return files === null ? null : files.split('\0').filter(Boolean).map((file) => path.relative(cwd, path.join(root, file)))
}
export function gitCommonDir(cwd) {
  const common = git(cwd, ['rev-parse', '--git-common-dir'])?.trim()
  return common ? fileIdentity(path.resolve(cwd,common)) : null
}

export function projectReferences(cwd, root = cwd, files = []) {
  const directories = new Set([root])
  for (const initial of [cwd, ...files.map((file) => path.dirname(file))]) {
    for (let dir = initial; dir !== root && dir.startsWith(root + path.sep); dir = path.dirname(dir)) directories.add(dir)
  }
  function reference(file, kind) {
    try {
      const stat = fs.statSync(file)
      if (!stat.isFile() || stat.size === 0) return null
      // Canonical containment avoids following a project doc symlink into private stores.
      const real = fileIdentity(file)
      if (path.relative(root, real).startsWith(`..${path.sep}`)) return null
      return { path: real, name: path.relative(root, file), scope: path.dirname(file), sha256: hashFile(real), kind }
    } catch { return null }
  }
  const rules = [...directories].sort().map((dir) =>
    reference(path.join(dir, 'AGENTS.override.md'), 'project-rules') ?? reference(path.join(dir, 'AGENTS.md'), 'project-rules'))
  return [...rules, ...['README.md', 'README.zh.md', '.editorconfig', 'package.json', 'Package.swift', 'pyproject.toml', '.handshake/project.md']
    .map((name) => reference(path.join(cwd, name), 'reference'))].filter(Boolean)
}
export function workspaceSnapshot(projectDir, { includeDiff = true } = {}) {
  const cwd = fileIdentity(projectDir)
  let directory = false
  try { directory = Boolean(cwd) && fs.statSync(cwd).isDirectory() } catch { /* readable error below */ }
  if (!directory) throw new Error('项目目录不存在')
  const root = git(cwd, ['rev-parse', '--show-toplevel'])?.trim() ?? null
  const warnings = []
  let files = []
  let status = null, head = null, branch = null, diff = null, indexDigest = null, unstagedDigest = null
  const stagedFiles = new Map()
  if (root) {
    status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    head = git(cwd, ['rev-parse', 'HEAD'])?.trim() ?? null
    branch = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])?.trim() ?? '(detached)'
    const modified = git(root, ['ls-files', '--modified', '--others', '--exclude-standard', '-z'])
    const index = git(root, ['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z'])
    const changes = git(root, ['diff', '--raw', '--no-abbrev', '--no-renames', '-z'])
    if (status === null || modified === null || index === null || changes === null) throw new Error('无法读取完整 Git 工作区状态')
    indexDigest = digest(index)
    unstagedDigest = digest(changes)
    const records = index.split('\0')
    for (let i = 0; i + 1 < records.length; i += 2) stagedFiles.set(records[i + 1], digest(records[i]))
    files = [...new Set([...modified.split('\0').filter(Boolean), ...stagedFiles.keys()])].map((name) => path.join(root, name))
  } else {
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (OMIT.has(entry.name) || entry.name.startsWith('.pre-')) continue
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) walk(file)
        else if (entry.isFile()) files.push(file)
        if (files.length > 5000) throw new Error('非 Git 项目超过 5000 个文件，无法建立完整快照；请先明确较小的项目目录')
      }
    }
    walk(cwd)
  }
  const entries = files.sort().map((file) => {
    const name = path.relative(cwd, file)
    const index = stagedFiles.get(path.relative(root ?? cwd, file)) ?? null
    try {
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) return { path: name, index, symlink: true, sha256: digest(fs.readlinkSync(file)) }
      if (!stat.isFile()) return { path: name, index, mode: stat.mode }
      return { path: name, index, sha256: hashFile(file), mode: stat.mode }
    }
    catch (error) {
      if (error.code === 'ENOENT') return { path: name, index, deleted: true }
      throw error
    }
  })
  const references = projectReferences(cwd, root ?? cwd, files)
  const snapshot = { cwd, gitRoot: root, head, branch, status, files: entries, references, indexDigest, unstagedDigest, diff, warnings }
  snapshot.digest = digest({ cwd, root, head, branch, status, files: entries, references, indexDigest, unstagedDigest })
  snapshot.capturedAt = new Date().toISOString()
  return includeDiff ? addWorkspaceDiff(snapshot) : snapshot
}
export function addWorkspaceDiff(snapshot) {
  if (!snapshot.gitRoot) return snapshot
  const unstaged = git(snapshot.gitRoot, ['diff', '--no-ext-diff', '--binary'])
  const staged = git(snapshot.gitRoot, ['diff', '--cached', '--no-ext-diff', '--binary'])
  if (unstaged === null || staged === null) snapshot.warnings.push('Git diff 超过读取上限；请按文件清单回查实际代码')
  snapshot.diff = { staged, unstaged }
  return snapshot
}
