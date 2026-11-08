/**
 * Execution transports.
 *
 *   T1 codex-exec (primary): spawn the Codex binary bundled inside the Codex
 *      desktop app (`codex exec`, optionally `exec resume <id>`), prompt on
 *      stdin, output to the task's run log. Same binary, same version and
 *      account as the app — this IS the app's own runtime.
 * There is no manual path in normal operation; failures surface on the board.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { homeDir } from './util.js'
import { renderPrompt } from './packet.js'
import { runLogPath } from './store.js'
import { codexHome } from './codex.js'

export { codexHome }

const BUNDLED_CODEX_CANDIDATES = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  path.join(homeDir(), '.codex', 'plugins', '.plugin-appserver', 'codex-cli', 'CodexCLI.app', 'Contents', 'MacOS', 'codex'),
]

/** Resolve the Codex executable: config override, bundled app runtime, PATH. */
export function resolveCodexBinary(config) {
  const configured = config?.codexBinary
  if (typeof configured === 'string' && configured.trim() !== '') {
    return { bin: configured, source: 'config' }
  }
  for (const candidate of BUNDLED_CODEX_CANDIDATES) {
    try {
      if (fs.statSync(candidate).isFile()) return { bin: candidate, source: 'bundled-app' }
    } catch {
      /* next */
    }
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

/**
 * T1: run the task on Codex. Continues the task's own Codex thread when one is
 * linked (codexSessionId), otherwise starts a fresh one.
 * @returns {{ transport: string, pid: number, bin: string, logFile: string, startedAt: string }}
 */
export async function executeToCodex(task, config) {
  const { bin, source } = resolveCodexBinary(config)
  const prompt = renderPrompt(task.packet)
  const logFile = runLogPath(task.runId ?? task.id)
  const sandbox = typeof config?.codexSandbox === 'string' ? config.codexSandbox : 'workspace-write'

  // Parent options must precede `resume`; that subcommand does not accept --sandbox.
  const args = ['exec', '--sandbox', sandbox, '--json', '--skip-git-repo-check', '--cd', task.projectDir]
  if (task.packet?.manifestPath) args.push('--add-dir', path.dirname(task.packet.manifestPath))
  const resumeId = task.execution?.codexSessionId ?? task.source?.codexSessionId ?? null
  if (typeof resumeId === 'string' && resumeId !== '') args.push('resume', resumeId)
  args.push('-')
  const cwd = task.projectDir
  if (!cwd || !fs.statSync(cwd).isDirectory()) throw new Error('项目目录不存在，无法执行交接任务')
  const resultFile = `${logFile}.result.json`
  try { fs.unlinkSync(resultFile) } catch { /* first run */ }
  const fd = fs.openSync(logFile, 'a')
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
      const log = fs.readFileSync(logFile, 'utf8')
      for (const line of log.split('\n')) {
        try {
          const event = JSON.parse(line)
          if (event.type === 'thread.started') sessionId = event.thread_id ?? event.threadId ?? sessionId
        } catch { /* human-readable log line */ }
      }
      fs.writeFileSync(resultFile, JSON.stringify({ exitCode, signal, sessionId, endedAt: new Date().toISOString() }))
    } catch { /* a missing result is surfaced as failure on the board */ }
  })
  child.stdin.end(prompt)
  child.unref()
  fs.closeSync(fd)

  return {
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
}

/** The unsupported internal automation-file transport is deliberately not used. */
export async function executeWithFallback(task, config) {
  return { ...await executeToCodex(task, config), note: 'codex exec started (bundled app runtime)' }
}
