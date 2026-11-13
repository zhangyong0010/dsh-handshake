import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { homeDir } from './util.js'
import { renderPrompt } from './packet.js'
import { runLogPath } from './store.js'
const runFile = promisify(execFile)

const BUNDLED_CODEX_CANDIDATES = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  path.join(homeDir(), '.codex', 'plugins', '.plugin-appserver', 'codex-cli', 'CodexCLI.app', 'Contents', 'MacOS', 'codex'),
]

export function resolveCodexBinary(config) {
  const configured = config?.codexBinary
  if (typeof configured === 'string' && configured.trim() !== '') {
    return { bin: configured, source: 'config' }
  }
  for (const candidate of BUNDLED_CODEX_CANDIDATES) {
    try {
      fs.accessSync(candidate,fs.constants.X_OK)
      if (fs.statSync(candidate).isFile()) return { bin: candidate, source: 'bundled-app' }
    } catch { /* try the next executable */ }
  }
  return { bin: 'codex', source: 'path' }
}

export function isPidAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export const resultSchema = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(['completed', 'remaining', 'checks', 'evidence', 'nextStep'].map((key) =>
    [key, key === 'nextStep' ? { type: 'string' } : { type: 'array', items: { type: 'string' } }])),
  required: ['completed', 'remaining', 'checks', 'evidence', 'nextStep'],
}
const schemaSupport = new Map()
function supportsSchema(bin, resume) {
  const key = JSON.stringify([bin,resume,fs.statSync(bin,{throwIfNoEntry:false})?.mtimeMs ?? 0])
  if (!schemaSupport.has(key)) {
    const args = resume ? ['exec', 'resume', '--help'] : ['exec', '--help']
    const request = runFile(bin,args,{encoding:'utf8',timeout:3000})
    request.child.stdin?.end()
    const probe = request.then(({stdout}) => /--output-schema\b/.test(stdout), () => {
        schemaSupport.delete(key)
        return false
      })
    schemaSupport.set(key,probe)
    if (schemaSupport.size > 16) schemaSupport.delete(schemaSupport.keys().next().value)
  }
  return schemaSupport.get(key)
}

export function readRunEvents(logFile) {
  if (!logFile) return []
  try {
    return fs.readFileSync(logFile, 'utf8').split('\n').flatMap((line) => {
      if (!line.startsWith('{')) return []
      try { return [JSON.parse(line)] } catch { return [] }
    })
  } catch { return [] }
}

export function codexWriterConflict(logFile, sessionId) {
  if (!logFile || !sessionId) return false
  try {
    return fs.readFileSync(logFile,'utf8').split('\n').some((line) =>
      /thread\/resume|thread-store conflict/.test(line) &&
      line.includes(`thread ${sessionId} already has an active writer`))
  } catch { return false }
}

export async function executeToCodex(task, config, onSpawn, beforeSpawn) {
  const { bin, source } = resolveCodexBinary(config)
  const prompt = task.reviewPrompt ?? renderPrompt(task.packet)
  const logFile = runLogPath(task.runId ?? task.id)
  const sandbox = task.packet?.executionPlan?.mode ?? (config?.codexSandbox === 'read-only' ? 'read-only' : 'workspace-write')

  // Parent options must precede `resume`; that subcommand does not accept --sandbox.
  const args = ['exec', '--sandbox', sandbox, '--json', '--skip-git-repo-check', '--cd', task.projectDir]
  if (task.packet?.manifestPath && sandbox === 'workspace-write') args.push('--add-dir', path.dirname(task.packet.manifestPath))
  const resumeId = task.reviewPrompt ? null : task.execution?.codexSessionId ?? null
  if (typeof resumeId === 'string' && resumeId !== '') args.push('resume', resumeId)
  if (task.packet?.manifestPath && await supportsSchema(bin, Boolean(resumeId))) {
    const schemaFile = `${logFile}.schema.json`
    fs.writeFileSync(schemaFile, JSON.stringify(resultSchema), { mode: 0o600 })
    args.push('--output-schema', schemaFile)
  }
  args.push('-')
  const cwd = task.projectDir
  if (!cwd || !fs.statSync(cwd).isDirectory()) throw new Error('项目目录不存在，无法执行交接任务')
  await beforeSpawn?.()
  const resultFile = `${logFile}.result.json`
  try { fs.unlinkSync(resultFile) } catch { /* first run */ }
  const fd = fs.openSync(logFile, 'w', 0o600)
  fs.writeSync(fd, `\n===== dsh-handshake run ${new Date().toISOString()} · ${bin} ${args.join(' ')} =====\n`)
  let child
  try {
    child = spawn(bin, args, {
      cwd,
      detached: true,
      stdio: ['pipe', fd, fd],
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
    })
  } catch (error) {
    fs.closeSync(fd)
    throw new Error(`spawn failed (${bin}): ${error?.message ?? error}`)
  }
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  } catch (error) {
    fs.closeSync(fd)
    throw new Error(`spawn failed (${bin}): ${error.message}`)
  }
  child.stdin.on('error', () => {})
  child.once('close', (exitCode, signal) => {
    let sessionId = resumeId
    try {
      for (const event of readRunEvents(logFile)) if (event.type === 'thread.started') sessionId = event.thread_id ?? event.threadId ?? sessionId
      const tmp = `${resultFile}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ exitCode, signal, sessionId, endedAt: new Date().toISOString() }), { mode: 0o600 })
      fs.renameSync(tmp, resultFile)
    } catch { /* a missing result is surfaced as failure on the board */ }
  })
  const execution = {
    transport: 'codex-exec',
    binSource: source,
    pid: child.pid,
    bin,
    logFile,
    resultFile,
    codexSessionId: resumeId,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
  }
  try {
    onSpawn?.(execution)
    child.stdin.end(prompt)
    child.unref()
  } catch (error) {
    child.kill()
    throw error
  } finally { fs.closeSync(fd) }
  return execution
}
