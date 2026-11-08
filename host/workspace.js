/** Read-only workspace evidence. No commits, checkout, stash, or dependency changes. */
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
    const buffer = Buffer.alloc(64 * 1024)
    let count
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count))
    return hash.digest('hex')
  } finally { fs.closeSync(fd) }
}
const git = (cwd, args) => {
  const result = spawnSync('/usr/bin/git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 })
  return result.status === 0 ? result.stdout : null
}
export function projectReferences(cwd) {
  return ['AGENTS.md', 'README.md', 'README.zh.md', '.editorconfig', 'package.json', 'Package.swift', 'pyproject.toml', '.handshake/project.md']
    .flatMap((name) => {
      const file = path.join(cwd, name)
      try {
        if (!fs.statSync(file).isFile()) return []
        // Canonical containment avoids following a project doc symlink into private stores.
        const real = fileIdentity(file)
        if (real !== cwd && !real.startsWith(cwd + path.sep)) return []
        return [{ path: real, name, sha256: hashFile(real), kind: name === 'AGENTS.md' ? 'project-rules' : 'reference' }]
      } catch { return [] }
    })
}
export function workspaceSnapshot(projectDir) {
  const cwd = fileIdentity(projectDir)
  let directory = false
  try { directory = Boolean(cwd) && fs.statSync(cwd).isDirectory() } catch { /* readable error below */ }
  if (!directory) throw new Error('项目目录不存在')
  const root = git(cwd, ['rev-parse', '--show-toplevel'])?.trim() ?? null
  const warnings = []
  let files = []
  let status = null, head = null, branch = null, diff = null
  if (root) {
    status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    head = git(cwd, ['rev-parse', 'HEAD'])?.trim() ?? null
    branch = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])?.trim() ?? '(detached)'
    const modified = git(root, ['ls-files', '--modified', '--others', '--exclude-standard', '-z'])
    const staged = git(root, ['diff', '--cached', '--name-only', '-z'])
    if (status === null || modified === null || staged === null) throw new Error('无法读取完整 Git 工作区状态')
    files = [...new Set((modified + staged).split('\0').filter(Boolean))].map((name) => path.join(root, name))
    // Retain staged and unstaged changes separately; do not trust an assistant's claimed file list.
    const unstagedDiff = git(root, ['diff', '--no-ext-diff', '--binary'])
    const stagedDiff = git(root, ['diff', '--cached', '--no-ext-diff', '--binary'])
    if (unstagedDiff === null || stagedDiff === null) warnings.push('Git diff 超过读取上限；请按文件清单回查实际代码')
    diff = { staged: stagedDiff, unstaged: unstagedDiff }
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
    try { return { path: name, sha256: hashFile(file) } }
    catch (error) {
      if (error.code === 'ENOENT') return { path: name, deleted: true }
      throw error
    }
  })
  const references = projectReferences(cwd)
  const snapshot = { cwd, gitRoot: root, head, branch, status, files: entries, references, diff, warnings }
  snapshot.digest = digest({ cwd, root, head, branch, status, files: entries, references })
  snapshot.capturedAt = new Date().toISOString()
  return snapshot
}
