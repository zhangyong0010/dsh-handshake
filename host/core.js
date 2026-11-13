import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createTask, loadTask, saveTask, deleteTask as storeDeleteTask, loadAllTasks, loadTaskViews, taskSummary, addRelay, storeRoot, runLogPath } from './store.js'
import { buildPacket, renderPrompt, PACKET_SCHEMA } from './packet.js'
import { dshProjectNames, extractDshContext, harvest, listDshSessions, observeDshRequest, readDshRunEvents } from './dsh-session.js'
import { codexProjectNames, parseRollout, listCodexThreads, findRunSessionFile, isCodexUsageLimit, pickTaskText, taskTitle } from './codex.js'
import { codexWriterConflict, executeToCodex, isPidAlive, readRunEvents, resolveCodexBinary } from './executor.js'
import { sessionId as normalizeId, fileIdentity, groupProjects, activityTime } from './identity.js'
import { resolveProject, readProject, listProjects, saveProject, updateProject as updateMaster, sameProject, matchesTaskSession, acquireProject, releaseProject, activeProjectTask, isActiveTask as active } from './projects.js'
import { addWorkspaceDiff, changesBetweenCommits, workspaceSnapshot, digest, gitCommonDir } from './workspace.js'
import { captureContext, normalizeMessages, redact } from './context.js'
import { readReceipt, validateReferences, writeReceipt } from './receipt.js'
import { withDeadline } from './util.js'

function get(ctx, name) { try { return ctx?.get?.(name) } catch { return undefined } }
const opposite = (kind) => kind === 'codex' ? 'dsh' : 'codex'
const roundOf = (task) => task.rounds?.find((round) => round.revision === task.revision)
function updateRound(task, fields) { const round = roundOf(task); if (round) Object.assign(round, fields) }
function ownTask(id) { const task = loadTask(id); if (!task) throw new Error('task not found'); return task }
const messageDigest = (messages) => digest(messages.map(({ role, text, seq, at }) => ({ role, text, seq, at })))
const runFile = promisify(execFile)
const codexThreadUrl = (id) => process.platform === 'darwin' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id ?? '') ? `codex://threads/${id}` : null
const historyTask = (task) => !active(task) && Boolean(task.archivedAt || (task.status === 'done' && !task.restoredAt))
const taskRank = { unknown:6, executing:5, preparing:5, staged:4, 'awaiting-review':3, failed:2, done:1 }
const writerConflict = 'codex-session-occupied'
const writerConflictMessage = '原 Codex 会话正被客户端占用。可离开该会话后重试，或在同一项目目录准备新会话。'
function blocked(message, code, client) { return Object.assign(new Error(message), { code, client }) }
function hasWriterConflict(task) {
  const id = task.packet?.executionPlan?.targetSession
  const run = task.execution
  return task.status === 'failed' && task.target === 'codex' && id && run?.codexSessionId === id &&
    (run.failureCode === writerConflict || (!run.failureCode && codexWriterConflict(run.logFile,id)))
}
function testCommand(command) {
  const shell = String(command ?? '').match(/^\S*\/(?:ba|z|da)?sh\s+-l?c\s+(['"])(.*)\1$/s)
  const body = (shell?.[2] ?? String(command ?? '')).trim()
  if (/[;&|<>\n`]/.test(body) || body.includes('$')) return false
  return /^(?:(?:npm|pnpm|yarn|bun) (?:run )?test\b|(?:node|bun) --test\b|bun test\b|(?:npx |pnpm exec |yarn )?(?:vitest|jest|pytest)\b|(?:python3? -m (?:pytest|unittest)|swift test|cargo test|go test|dotnet test|ctest|make test)\b|(?:sh|bash|zsh) (?:\.\/)?(?:[^\s/]+\/)*(?:verify|test)[\w.-]*\.sh\b|\.\/(?:verify|test)[\w.-]*\.sh\b)/.test(body)
}

function presentResult(result) {
  const checks = result?.observed?.checks
  if (!checks?.some((check) => check.test == null && Number.isInteger(check.exitCode) && testCommand(check.command))) return result
  return { ...result, observed: { ...result.observed, checks: checks.map((check) =>
    check.test == null && Number.isInteger(check.exitCode) && testCommand(check.command) ? { ...check, test:true } : check) } }
}

function parseReportedResult(text) {
  try {
    const value = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
    const keys = ['completed', 'remaining', 'checks', 'evidence']
    if (!value || typeof value.nextStep !== 'string' || !keys.every((key) => Array.isArray(value[key]) && value[key].every((item) => typeof item === 'string'))) return null
    return Object.fromEntries([...keys.map((key) => [key, value[key].slice(0, 50).map((item) => redact(item).slice(0, 2000))]), ['nextStep', redact(value.nextStep).slice(0, 4000)]])
  } catch { return null }
}

export function createCore(ctx, config = {}) {
  const conversions = new Map(), executions = new Map(), reviews = new Map(), starting = new Set()
  let observing, candidateSnapshot, candidateRefresh, background = false
  let names = { codex: null, dsh: null }
  function projectLabel(kind, id, dir, project) {
    const index = names[kind]
    const membership = index?.forSession(id)
    if (membership) return membership
    const roots = project?.directories ?? [dir]
    const cwd = fileIdentity(dir)
    let best = [], length = -1
    for (const item of index?.projects ?? []) for (const root of item.roots) {
      if (typeof root !== 'string' || !path.isAbsolute(root)) continue
      const canonical = fileIdentity(root)
      const relative = path.relative(canonical, cwd)
      const within = relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      const sameRepository = !within && (roots.includes(canonical) || (project?.gitCommonDirs?.length && project.gitCommonDirs.includes(item.gitRoots?.get(canonical))))
      if (!within && !sameRepository) continue
      const score = within ? canonical.length : 0
      if (score < length) continue
      if (score > length) { best = []; length = score }
      best.push(item.name)
    }
    const unique = [...new Set(best)]
    return unique.length === 1 ? unique[0] : null
  }
  function present(task, project) {
    const origin = task.rounds?.[0]?.source ?? task.source
    const projectNames = {
      codex: projectLabel('codex', origin?.kind === 'codex' ? origin.codexSessionId : task.links?.codexSessionId, task.projectDir, project),
      dsh: projectLabel('dsh', origin?.kind === 'dsh' ? origin.sessionId : task.links?.dshSessionId, task.projectDir, project),
    }
    const sessions = {
      codex: task.execution?.codexSessionId ?? task.links?.codexSessionId ?? null,
      dsh: task.execution?.dshSessionId ?? task.links?.dshSessionId ?? null,
    }
    const summary = task.summary ?? taskSummary(task)
    return { ...summary, result:presentResult(summary.result), reception:receptionFor(task), projectNames, sessions, inHistory:historyTask(task),
      projectName: projectNames[origin?.kind] ?? path.basename(task.projectDir), canOpenCodex: Boolean(codexThreadUrl(sessions.codex)) }
  }
  async function openCodex(id, role, { copy = false } = {}) {
    const task = ownTask(id)
    const session = role === 'source'
      ? task.source.kind === 'codex' && task.source.codexSessionId
      : task.execution?.codexSessionId ?? task.links?.codexSessionId
    const url = codexThreadUrl(session)
    if (!url) throw new Error('尚未找到可在桌面打开的 Codex 会话')
    if (copy) return url
    try { await runFile('/usr/bin/open', [url], { timeout: 10000 }) }
    catch { throw new Error('无法打开 Codex 桌面会话，请确认本机已安装 Codex') }
    return url
  }
  function reviewTask(args) {
    return serialize(reviews, JSON.stringify([args.taskId,args.runId]), () => launchReview(args))
  }
  async function launchReview({ taskId, runId }) {
    const task = ownTask(taskId)
    if (typeof runId !== 'string' || !['done','awaiting-review'].includes(task.status) || task.execution?.runId !== runId || !task.result || !task.packet?.brief) throw new Error('请在本轮执行结束后从结果卡发起审查')
    const reviewer = capabilities().codex
    if (!reviewer.available) throw new Error('Codex 审查能力不可用')
    const project = readProject(task.projectId)
    if (!project || activeProjectTask(project, task.id)) throw new Error('项目正在执行，请等待本轮结束')
    const existing = task.review
    validateReferences(task.packet)
    const snapshot = workspaceSnapshot(task.projectDir,{includeDiff:false})
    if (task.result.observed.endWorkspaceDigest && snapshot.digest !== task.result.observed.endWorkspaceDigest) throw new Error('工作区已变化，请先为当前代码建立新的接力结果')
    if (existing?.runId === runId && existing.workspaceDigest === snapshot.digest && ['running','complete'].includes(reviewView(task)?.status)) return existing
    const lease = acquireProject(project, task.id, task.revision, 'codex')
    const brief = task.packet.brief
    const originalRequirements = task.packet.references.find((ref) => ref.kind === 'task-requirements.json')?.path
    const review = { runId, workspaceDigest:snapshot.digest, status:'starting', logFile:null, resultFile:null }
    try {
      task.review = review
      saveTask(task)
      const reviewPrompt = [
        '# DSH-Handshake 独立审查 / Independent review\nIndependently review this completed handoff using read-only operations. Report prioritized concrete findings with file/line evidence and missing verification. Do not modify files or assume the author was correct.',
        `Original goal: ${brief.goal}`, `Latest request: ${brief.latestRequest}`, `Round clarification: ${brief.clarification ?? ''}`,
        `Original requirements with provenance: ${originalRequirements ?? 'unavailable'}`,
        `Project constraints and acceptance: ${JSON.stringify([brief.explicitRules,brief.acceptance])}`,
        `Baseline and file evidence: ${JSON.stringify(task.result.observed)}`,
        'Inspect the current workspace and relevant diff, including staged changes. Compare against the original goal and relevant scoped AGENTS rules. Return JSON using completed (findings), remaining, checks, evidence and nextStep.',
      ].join('\n\n')
      const input = { ...task, runId:`${task.id}-review-${randomUUID()}`, reviewPrompt, packet:{ ...task.packet, executionPlan:{ mode:'read-only' } } }
      await executeToCodex(input, { ...config, codexBinary:reviewer.binary }, (execution) => {
        Object.assign(review, execution, { runId, status:'running' }); saveTask(task)
      }, () => {
        if (workspaceSnapshot(task.projectDir,{includeDiff:false}).digest !== snapshot.digest) throw new Error('审查启动前工作区已变化')
      })
      return review
    } catch (error) {
      review.status = 'failed'; review.error = String(error.message); saveTask(task)
      throw error
    } finally { releaseProject(project.id, lease) }
  }
  function reviewView(task) {
    const review = task.review
    if (!review || review.runId !== task.execution?.runId) return null
    if (review.status === 'failed') return { status: 'failed', error: review.error }
    const events = readRunEvents(review.logFile)
    let outcome
    try { outcome = JSON.parse(fs.readFileSync(review.resultFile,'utf8')) } catch { /* may still be running */ }
    const event = events.findLast((row) => row.type === 'item.completed' && row.item?.type === 'agent_message')
    const text = event?.item.text
    const terminal = events.findLast((row) => ['turn.completed','turn.failed'].includes(row.type))
    let status = 'unknown'
    if (outcome) status = outcome.exitCode === 0 && terminal?.type !== 'turn.failed' ? 'complete' : 'failed'
    else if (isPidAlive(review.pid)) status = 'running'
    else if (terminal) status = terminal.type === 'turn.completed' ? 'complete' : 'failed'
    return { status,
      report:parseReportedResult(text), text:text ? redact(text).slice(0,6000) : null, logFile:review.logFile, workspaceDigest:review.workspaceDigest }
  }
  function cloudPlan(id) {
    const task = ownTask(id)
    if (!['awaiting-review','done'].includes(task.status) || !task.result) throw new Error('请在本轮结束后生成云端复验说明')
    const snapshot = workspaceSnapshot(task.projectDir,{includeDiff:false})
    if (!snapshot.head || snapshot.files.length || snapshot.head !== task.result.observed.endCommit || (task.result.observed.endWorkspaceDigest && snapshot.digest !== task.result.observed.endWorkspaceDigest)) {
      throw new Error('云端复验需要与本轮结果一致的干净 Git 提交；未提交改动请在本地验证')
    }
    return { commit:snapshot.head, url:'https://chatgpt.com/codex',
      instructions:[`Verify the handoff at commit ${snapshot.head}. Check out and report this exact commit.`,
        'Replay the same verification commands as the local run. Use the commands supplied by the user.',
        'Install locked dependencies when required. Return command names, exit codes, environment versions and failures. Leave repository files unchanged.'].join('\n') }
  }
  const serialize = (map, key, fn) => {
    if (map.has(key)) return map.get(key)
    const pending = Promise.resolve().then(fn).finally(() => map.delete(key)); map.set(key, pending); return pending
  }
  function capabilities() {
    const binary = resolveCodexBinary(config)
    const paths = binary.source === 'path' ? (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, binary.bin)) : [binary.bin]
    const executable = paths.find((file) => {
      try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile() } catch { return false }
    })
    const controller = get(ctx, 'sessionController')
    return { codex: { available: Boolean(executable), binary: executable ?? binary.bin, readOnly: true, transport: 'bundled-exec', receipt: 'local-file' },
      dsh: { available: typeof controller?.create === 'function' && typeof controller?.prompt === 'function', readOnly: false, receipt: 'handshake acknowledge tool' },
      sourceModelRequired: false, notes: ['目标端须使用自身可用工具；源端工具名不是目标端能力保证。'] }
  }
  function assertDshIdle(state, events, role) {
    const client = 'dsh'
    const prefix = role === 'source' ? '来源' : '目标'
    const lastTurn = !state.known && events?.findLast((event) => ['turn/start','turn/end'].includes(event?.type))
    if (state.running || state.queue?.length || lastTurn?.type === 'turn/start') {
      throw blocked(`${prefix} DSH 会话仍在运行或有待执行任务，请先等待或停止，再重新检查。`, role === 'source' ? 'source-running' : 'target-busy', client)
    }
    if (!state.known && !events) throw blocked(`暂时无法核实${prefix} DSH 会话。请打开会话检查。`, `${role}-unavailable`, client)
  }
  function stage(source, info, { force = false, taskId, clarification, clarificationScope, replaceTarget = false, expectedRevision, expectedDigest, preview = false, includeAssistant, retryUnverified = false } = {}) {
    const cwd = info.projectDir
    if (!cwd) throw new Error('会话缺少实际项目目录')
    const project = resolveProject(cwd)
    const matching = taskId ? [] : loadTaskViews().filter((record) => sameProject(record, project) && matchesTaskSession(record, source, cwd))
    const matchedId = taskId ?? (matching.find((record) => !record.archivedAt) ?? matching[0])?.id
    let task = matchedId ? ownTask(matchedId) : null
    if (task && (!sameProject(task, project) || !matchesTaskSession(task, source, cwd))) throw new Error('会话或实际工作目录与任务不一致')
    if (task?.archivedAt) throw new Error('该接力已归档，请先从历史恢复')
    if (active(task)) throw new Error('该任务仍在执行，请等待本轮结束后再接力')
    if (expectedRevision !== undefined && (task?.revision !== expectedRevision || task?.packet?.digest !== expectedDigest)) throw new Error('交接资料已更新，请重新查看本轮简报')
    const messages = normalizeMessages(info, source)
    if (!messages.length && !task?.requirements?.length) throw new Error('没有可交接的上下文')
    const snapshot = workspaceSnapshot(cwd,{includeDiff:false})
    const supported = capabilities()
    const target = opposite(source.kind)
    const linkedSession = target === 'codex' ? task?.links?.codexSessionId : task?.links?.dshSessionId
    const sourceDigest = messageDigest(messages)
    const unverified = retryUnverified && task?.status === 'awaiting-review' && task.target === 'dsh' &&
      ['pending','invalid'].includes(readReceipt(task.packet).status)
    const continuingRound = task && (unverified || ['staged','failed'].includes(task.status)) &&
      task.source.kind === source.kind && matchesTaskSession(task, source, cwd)
    const previous = task?.rounds?.findLast((round) => round.execution)
    const recoveryNote = previous?.status === 'failed' && !previous.clarificationScope ? (previous.clarification ?? task?.clarification) : null
    const note = (clarification ?? (continuingRound ? task.clarification : recoveryNote)) || null
    const noteScope = note ? (clarification !== undefined ? clarificationScope : continuingRound ? task.clarificationScope : null) ?? null : null
    const targetReplaced = Boolean(replaceTarget || (continuingRound && task.packet?.executionPlan?.targetReplaced))
    const retrySession = !replaceTarget && continuingRound && target === 'dsh' ? task.retryDshSessionId : null
    const targetSession = (targetReplaced ? retrySession : linkedSession ?? retrySession) ?? null
    const shareAssistant = includeAssistant ?? (continuingRound ? task.packet?.executionPlan?.includeAssistant !== false : true)
    const fingerprint = digest({ sourceId: [source.kind, source.sessionId ?? source.codexSessionId], sourceDigest, snapshot: snapshot.digest, masterRevision: project.masterRevision ?? 0, targetSession, targetReplaced, receiver: supported[target], configuredSandbox: config.codexSandbox ?? null, ...(note ? { note, noteScope } : {}), ...(!shareAssistant ? { includeAssistant:false } : {}) })
    if (['staged','failed'].includes(task?.status) && task.packet?.schema === PACKET_SCHEMA && task.contextFingerprint === fingerprint && !force) {
      if (!preview && !taskId && task.previewOnly) {
        delete task.previewOnly
        saveTask(task)
      }
      return task
    }
    if (task && preview && taskId && !task.previewPrevious && ['awaiting-review','done','failed'].includes(task.status)) {
      task.previewPrevious = structuredClone(task)
    }
    if (!task) task = createTask({ title: info.title || taskTitle(info.goal), projectDir: cwd, source }, { persist: false })
    if (!task.packet && preview) task.previewOnly = true
    if (!preview && !taskId) delete task.previewOnly
    // Preserve the pre-upgrade record before adding the round protocol.
    if (!task.rounds) {
      const dir = path.join(storeRoot(), 'history'); fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${task.id}-legacy.json`)
      if (task.packet && !fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(task, null, 2), { mode: 0o600 })
      task.rounds = []
    }
    if (task.status === 'staged') updateRound(task, { status: 'superseded', endedAt: new Date().toISOString() })
    task.projectId = project.id
    task.projectDir = snapshot.cwd
    task.source = source
    if (!task.rounds.length || task.rounds[0].from === source.kind) task.title = info.title || task.title
    task.revision = Math.max(task.revision ?? 0,task.discardedRevision ?? 0) + 1
    task.target = target
    task.clarification = note
    task.clarificationScope = noteScope
    if (replaceTarget || !continuingRound) delete task.retryDshSessionId
    task.links ??= {}
    if (source.kind === 'codex') {
      task.links.codexSessionId = source.codexSessionId
      task.links.codexRolloutFile = source.rolloutFile
    } else task.links.dshSessionId = source.sessionId
    const context = captureContext(task, project, messages, addWorkspaceDiff(snapshot), task.revision, { includeAssistant:shareAssistant })
    const mode = context.brief.scope.mode === 'workspace-write' && target === 'codex' && config.codexSandbox === 'read-only' ? 'read-only' : context.brief.scope.mode
    const executionPlan = { mode, sourceDigest, targetSession, targetReplaced, cwd: snapshot.cwd, receiver: supported[target], ...(!shareAssistant ? { includeAssistant:false } : {}) }
    task.packet = buildPacket({ ...context, taskId: task.id, projectId: project.id, revision: task.revision,
      masterRevision: project.masterRevision ?? 0, from: source.kind, fromSessionId: source.sessionId ?? source.codexSessionId,
      title: task.title, projectDir: task.projectDir, target, executionPlan, capabilities: supported, relay: task.relay })
    fs.writeFileSync(task.packet.manifestPath, JSON.stringify(task.packet, null, 2), { mode: 0o600 })
    task.contextFingerprint = fingerprint
    task.status = 'staged'; task.owner = 'none'; task.error = null; task.execution = null; task.lease = null; task.verification = null; task.result = null
    task.reception = receptionFor(task)
    task.rounds.push({ revision: task.revision, from: source.kind, to: task.target, source, status: 'staged', clarification:note, clarificationScope:noteScope,
      packetPath: task.packet.manifestPath, packetDigest: task.packet.digest, workspaceDigest: snapshot.digest, createdAt: new Date().toISOString() })
    addRelay(task, { from: source.kind, to: task.target, action: 'prepare', revision: task.revision, note: `第 ${task.revision} 轮，完整用户证据 ${context.coverage.userMessages} 条` })
    saveTask(task)
    return task
  }
  function convertCodex({ rolloutFile, ...options }) {
    if (!rolloutFile) throw new Error('rolloutFile is required')
    const info = parseRollout(rolloutFile)
    if (info.error) throw new Error(info.error)
    info.goal = pickTaskText(info.userTexts)
    info.title = taskTitle(info.goal) || 'Codex 接力任务'
    return stage({ kind: 'codex', rolloutFile: fileIdentity(rolloutFile), codexSessionId: info.sessionId }, info, options)
  }
  function convertDsh({ sessionId, ...options }) {
    const id = normalizeId(sessionId)
    if (!id) return Promise.reject(new Error('sessionId is required'))
    const key = JSON.stringify(['dsh', id, options])
    return serialize(conversions, key, async () => {
      const info = await extractDshContext(ctx, id)
      return stage({ kind: 'dsh', sessionId: id }, info, options)
    })
  }
  async function refreshTask({ taskId, ...options }) {
    const task = ownTask(taskId)
    return task.source.kind === 'codex' ? convertCodex({ ...options, rolloutFile: task.source.rolloutFile, taskId }) : convertDsh({ ...options, sessionId: task.source.sessionId, taskId })
  }
  async function clarify({ taskId, expectedRevision, expectedDigest, note, scope }) {
    if (!Number.isSafeInteger(expectedRevision) || typeof expectedDigest !== 'string' || typeof note !== 'string' || note.length > 2000) throw new Error('本轮补充最多 2000 字，请先核对交接版本')
    if (!['staged','failed'].includes(ownTask(taskId).status)) throw new Error('本轮已启动，请在下一轮接力时补充')
    if (scope != null && !['task','round'].includes(scope)) throw new Error('未知的补充适用范围')
    return refreshTask({ taskId, expectedRevision, expectedDigest, clarification: redact(note.trim()), clarificationScope:scope })
  }
  async function setSharing({ taskId, expectedRevision, expectedDigest, includeAssistant }) {
    if (!Number.isSafeInteger(expectedRevision) || typeof expectedDigest !== 'string' || typeof includeAssistant !== 'boolean') throw new Error('请重新核对交接简报')
    return refreshTask({ taskId, expectedRevision, expectedDigest, includeAssistant })
  }
  async function prepareNext({ taskId, sourceKind, preview = false }) {
    await finalizeTasks()
    const task = ownTask(taskId)
    if (active(task)) throw new Error('当前轮仍在执行，不能切换接力方')
    if (task.previewPrevious && preview) return refreshTask({taskId})
    const kind = sourceKind ?? task.lastExecutedBy ?? task.source.kind
    if (!['codex','dsh'].includes(kind)) throw new Error('unknown source kind')
    const completedRevision = task.rounds?.filter((round) => round.execution).at(-1)?.revision ?? 0
    if (task.status === 'staged' && task.preparedFromRun === completedRevision && task.source.kind === kind) return refreshTask({ taskId })
    const remember = (prepared) => {
      const current = ownTask(prepared.id)
      if (current.revision !== prepared.revision || active(current)) return current
      current.preparedFromRun = completedRevision
      return saveTask(current)
    }
    if (kind === 'codex') {
      const id = task.links?.codexSessionId ?? task.source.codexSessionId
      const knownFile = task.links?.codexRolloutFile ?? (task.source.kind === 'codex' ? task.source.rolloutFile : null)
      const file = knownFile && parseRollout(knownFile).sessionId === id ? knownFile
        : id && findRunSessionFile(0,{sessionId:id,projectDir:task.projectDir})?.file
      if (!file) throw new Error('未找到本轮 Codex 会话，请先检查执行日志')
      return remember(convertCodex({ rolloutFile: file, taskId, force: true, preview }))
    }
    const id = task.links?.dshSessionId ?? (task.source.kind === 'dsh' ? task.source.sessionId : null)
    if (!id) throw new Error('未找到本轮 DSH 会话')
    return remember(await convertDsh({ sessionId: id, taskId, force: true, preview }))
  }
  async function dshState(id) {
    if (!id) return { known:false, running:false }
    const controller = get(ctx, 'sessionController')
    if (typeof controller?.state === 'function') {
      for (const candidate of new Set([id, `session-${normalizeId(id)}`])) {
        try {
          const state = await withDeadline((signal) => controller.state({ sessionId:candidate },signal))
          if (typeof state?.running === 'boolean') return { ...state, known: true }
        } catch { /* try the runtime's canonical ID */ }
      }
    }
    const registry = get(ctx, 'agents')
    const agent = registry?.get?.(id) ?? registry?.get?.(`session-${normalizeId(id)}`) ?? registry?.get?.(normalizeId(id))
    if (agent) return { running: agent.status === 'running', known: true }
    return { known: false, running: false }
  }
  async function assertSourceIdle(task, stoppedSource) {
    if (task.source.kind === 'dsh') {
      const state = await dshState(task.source.sessionId)
      const events = state.known ? null : await readDshRunEvents(ctx,task.source.sessionId)
      assertDshIdle(state,events,'source')
    } else {
      const before = rolloutStamp({ file:task.source.rolloutFile, sessionId:task.source.codexSessionId })
      const parsed = parseRollout(task.source.rolloutFile)
      if (parsed.error) throw blocked('暂时无法读取来源 Codex 会话。', 'source-unavailable', 'codex')
      if (before !== rolloutStamp(parsed)) throw blocked('来源 Codex 会话仍在更新。请稍后重新检查。', 'source-running', 'codex')
      if (parsed.running) throw blocked('来源 Codex 会话仍在运行。请先停止或等待本轮结束，再重新检查。', 'source-running', 'codex')
      const stopToken = digest([task.packet.digest, before])
      if (parsed.running === null && parsed.interruption && stoppedSource !== stopToken) {
        throw Object.assign(blocked('Codex 遇到用量限制，插件未读到本轮结束。请打开来源会话，确认它已停止。', 'source-interrupted', 'codex'), { stopToken })
      }
    }
  }
  function rolloutStamp(parsed) {
    const file = fs.statSync(parsed.file, { throwIfNoEntry: false })
    return file && digest([parsed.sessionId, parsed.file, file.size, file.mtimeMs])
  }
  async function targetSession(task) {
    const { target, projectDir, packet } = task
    const id = packet.executionPlan.targetSession
    if (!id) return null
    if (target === 'codex') {
      let linked = task.links?.codexRolloutFile ? parseRollout(task.links.codexRolloutFile) : null
      if (linked?.sessionId !== id) {
        const discovered = findRunSessionFile(0, { sessionId: id, projectDir })
        linked = discovered ? parseRollout(discovered.file) : null
      }
      if (!linked || linked.sessionId !== id || fileIdentity(linked.projectDir) !== projectDir) throw blocked('找不到位于本轮工作区的原 Codex 会话。', 'target-missing', target)
      if (linked.running || (linked.running === null && linked.interruption && task.stoppedCodex !== rolloutStamp(linked))) {
        throw blocked('目标 Codex 会话的任务可能仍在运行。请先打开检查。', 'target-busy', target)
      }
      return id
    }
    return exactDshSession(id, projectDir)
  }
  async function exactDshSession(id, projectDir) {
    const target = 'dsh'
    const query = get(ctx, 'sessionQuery')
    if (typeof query?.readSession !== 'function') throw blocked('暂时无法读取原 DSH 会话。', 'target-unavailable', target)
    let unavailable = false
    const bareId = normalizeId(id)
    for (const candidate of new Set([id,`session-${bareId}`,bareId])) {
      try {
        const entry = await withDeadline(() => query.readSession(candidate))
        const header = entry?.session ?? entry?.header
        if (!header?.cwd || fileIdentity(header.cwd) !== projectDir) continue
        if (header.id && normalizeId(header.id) !== normalizeId(id)) continue
        return header.id ?? candidate
      } catch (error) {
        if (!/not.?found|missing|enoent/i.test(String(error.code ?? error.message))) unavailable = true
      }
    }
    if (unavailable) throw blocked('原 DSH 会话暂时无法核实。请重新检查。', 'target-unavailable', target)
    throw blocked('找不到位于本轮工作区的原 DSH 会话。', 'target-missing', target)
  }
  async function openDsh(id, role) {
    const task = ownTask(id)
    const session = role === 'source'
      ? task.source.kind === 'dsh' && task.source.sessionId
      : task.execution?.dshSessionId ?? task.links?.dshSessionId
    if (!session) throw new Error('尚未找到可打开的关联 DSH 会话')
    return exactDshSession(session, task.projectDir)
  }
  async function replaceMissingTarget({ taskId, expectedRevision, expectedDigest }) {
    const task = ownTask(taskId)
    if (!['staged','failed'].includes(task.status) || !task.packet?.executionPlan?.targetSession ||
      task.revision !== expectedRevision || task.packet.digest !== expectedDigest) throw new Error('接力资料已更新，请重新检查目标会话')
    try { await targetSession(task) } catch (error) {
      if (error.code !== 'target-missing') throw error
      return refreshTask({ taskId, expectedRevision, expectedDigest, replaceTarget: true })
    }
    if (hasWriterConflict(task)) return refreshTask({ taskId, expectedRevision, expectedDigest, replaceTarget:true })
    throw new Error('原目标会话已恢复，请继续使用原会话')
  }
  function assertReceiverReady(task) {
    const { mode, receiver } = task.packet.executionPlan
    if (mode === 'conflict') throw blocked('这一轮同时要求只看和修改。请在来源会话说明当前要做哪一项。', 'source-scope-conflict', task.source.kind)
    if (mode === 'read-only' && !receiver.readOnly) throw blocked('当前 DSH 接收端无法强制只读，未启动。请在原会话继续只读审查。', 'source-read-only', task.source.kind)
    if (!receiver.available) throw blocked(task.target === 'codex'
      ? '找不到可执行的 Codex。请检查本机是否安装 Codex，或确认插件里的 Codex 路径。'
      : 'DSH 的会话服务暂未就绪。请重启 DSH 后重新检查。', 'receiver-unavailable', task.target)
  }
  async function checkReadiness(task) {
    const project = readProject(task.projectId)
    if (activeProjectTask(project, task.id)) throw blocked('这个项目已有接力在执行。请等当前任务结束。', 'project-busy', task.target)
    assertReceiverReady(task)
    await assertSourceIdle(task)
    const id = await targetSession(task)
    if (id && task.target === 'dsh') {
      const [state,events] = await Promise.all([dshState(id),readDshRunEvents(ctx,id)])
      assertDshIdle(state,events,'target')
    }
    return task
  }
  async function checkTask({ taskId }) {
    return checkReadiness(await refreshTask({ taskId }))
  }
  async function inspectTask(taskId, expectedDigest) {
    const task = ownTask(taskId)
    try {
      if (task.packet?.digest !== expectedDigest) throw blocked('交接资料已更新，请重新检查。','brief-changed')
      await checkReadiness(task)
      return { status:'ready' }
    } catch (error) {
      return { status:'blocked', message:error.message, code:error.code, client:error.client, stopToken:error.stopToken }
    }
  }
  function materials(taskId, expectedDigest, kind, offset = 0) {
    const task = ownTask(taskId)
    const packet = task.packet
    if (!packet || packet.digest !== expectedDigest) throw blocked('交接资料已更新，请重新打开简报。', 'brief-changed')
    const files = [
      {kind:'prompt',name:'prompt'},
      ...(packet.references ?? []).filter((ref) => ['task-requirements.json','workspace.json','project-master.json','assistant-history.json','project-rules'].includes(ref.kind)),
    ]
    const list = files.map((ref,index) => ({ index, kind:ref.kind, name:ref.name ?? ref.kind }))
    if (kind == null) return { files:list }
    const ref = files[Number(kind)]
    if (!ref || !Number.isSafeInteger(offset) || offset < 0) throw new Error('找不到要查看的交接资料')
    const contents = ref.kind === 'prompt' ? renderPrompt(packet) : fs.readFileSync(ref.path,'utf8')
    if (ref.kind !== 'prompt' && digest(contents) !== ref.sha256) throw blocked('交接资料已变化，请重新准备简报。','brief-changed')
    const safe = redact(contents)
    const end = Math.min(safe.length,offset + 24000)
    return { files:list, text:safe.slice(offset,end), nextOffset:end < safe.length ? end : null }
  }
  function discardPreview({ taskId, expectedRevision, expectedDigest }) {
    const task = loadTask(taskId)
    if (!task) return true
    if (!(task.previewOnly || task.previewPrevious) || task.status !== 'staged' || task.revision !== expectedRevision ||
      task.packet?.digest !== expectedDigest || starting.has(taskId) || [...executions.keys()].some((key) => JSON.parse(key)[0] === taskId)) return true
    if (task.previewPrevious) {
      saveTask({...task.previewPrevious,discardedRevision:task.revision})
      return true
    }
    storeDeleteTask(task.id)
    return true
  }
  function executeTask(args) {
    const task = ownTask(args.taskId)
    const confirmed = { revision: args.expectedRevision ?? task.revision, digest: args.expectedDigest ?? task.packet?.digest }
    const key = JSON.stringify([task.id, confirmed.revision, confirmed.digest, args.target ?? task.target, args.stoppedSource ?? null])
    return serialize(executions, key, () => executeOnce(args, confirmed))
  }
  async function executeOnce({ taskId, target, stoppedSource }, confirmed) {
    let task = ownTask(taskId)
    const previous = task.packet?.digest === confirmed.digest ? task.packet : null
    const check = (record) => {
      if (record.revision === confirmed.revision && record.packet?.digest === confirmed.digest) return
      const current = record.packet
      const reason = previous && current && (
        (previous.workspace?.digest !== current.workspace?.digest && '项目文件、分支或目录规则有变化。') ||
        (previous.executionPlan?.sourceDigest !== current.executionPlan?.sourceDigest && '来源会话有新内容。') ||
        (previous.masterRevision !== current.masterRevision && '项目要求有变化。') ||
        (previous.executionPlan?.targetSession !== current.executionPlan?.targetSession && '目标会话有变化。')
      )
      throw blocked(`${reason || ''}交接资料已更新为第 ${record.revision ?? 0} 轮，请重新核对后确认`, 'brief-changed')
    }
    if (!['staged','failed'].includes(task.status)) throw new Error('仅待执行或失败的任务可以启动')
    check(task)
    task = await refreshTask({ taskId })
    check(task)
    const effective = target ?? task.target
    if (!['dsh','codex'].includes(effective)) throw new Error('unknown execute target')
    if (effective !== task.target) throw new Error('执行方向与本轮交接包不一致，请重新准备交接')
    const project = readProject(task.projectId)
    if (activeProjectTask(project, task.id)) throw new Error('该项目已有执行中的接力任务')
    await assertSourceIdle(task, stoppedSource)
    let plan = task.packet.executionPlan
    assertReceiverReady(task)
    const resolvedTarget = await targetSession(task)
    task = ownTask(taskId)
    check(task)
    if (!['staged','failed'].includes(task.status)) throw new Error('仅待执行或失败的任务可以启动')
    const lease = acquireProject(project, task.id, task.revision, effective)
    starting.add(taskId)
    let recorded = false
    try {
      await assertSourceIdle(task, stoppedSource)
      // Revalidate under the lease after asynchronous status and target lookups.
      task = await refreshTask({ taskId })
      check(task)
      plan = task.packet.executionPlan
      if (!['staged','failed'].includes(task.status)) throw new Error('仅待执行或失败的任务可以启动')
      if ((readProject(task.projectId)?.masterRevision ?? 0) !== task.packet.masterRevision) throw new Error('项目规则已变化，请刷新接力资料后确认')
      if (digest(plan.receiver) !== digest(capabilities()[effective])) throw new Error('接收端运行能力已变化，请刷新接力资料后确认')
      validateReferences(task.packet)
      const workspaceDigest = task.packet.workspace.digest
      const runId = `${task.id}-r${task.revision}-${randomUUID()}`
      const startedAtMs = Date.now()
      task.status = 'preparing'; task.owner = effective; task.lease = lease; task.error = null
      delete task.previewOnly
      delete task.previewPrevious
      task.preflight = { status: 'passed', workspaceDigest, checkedAt: new Date().toISOString(), capabilities: plan.receiver }
      task.approval = { ...confirmed, target: effective, cwd: task.projectDir, mode: plan.mode, at: new Date().toISOString() }
      if (effective === 'dsh' && stoppedSource) {
        const parsed = parseRollout(task.source.rolloutFile)
        if (!parsed.error && parsed.interruption && parsed.running === null && digest([task.packet.digest, rolloutStamp(parsed)]) === stoppedSource) task.stoppedCodex = rolloutStamp(parsed)
      }
      updateRound(task, { approval: task.approval })
      task.execution = { runId, target: effective, startedAtMs, startedAt: new Date(startedAtMs).toISOString(), phase: 'intent' }
      saveTask(task)
      recorded = true
      if (effective === 'codex') {
        const input = { ...task, execution: { codexSessionId: resolvedTarget }, runId }
        const launched = await executeToCodex(input, { ...config, codexBinary:plan.receiver.binary }, (execution) => {
          Object.assign(task.execution, execution, { phase: 'dispatching' })
          saveTask(task)
        }, async () => {
          await assertSourceIdle(task, stoppedSource)
          await targetSession(task)
          const source = await extractDshContext(ctx, task.source.sessionId)
          if (messageDigest(normalizeMessages(source,task.source)) !== plan.sourceDigest ||
            workspaceSnapshot(task.projectDir,{includeDiff:false}).digest !== workspaceDigest) {
            throw new Error('启动前来源任务或代码已变化，请刷新接力包')
          }
          validateReferences(task.packet)
        })
        Object.assign(task.execution, launched, { phase: 'accepted' })
      } else {
        const controller = get(ctx, 'sessionController')
        let id = resolvedTarget
        if (!id) {
          const requestedSession = `session-${randomUUID()}`
          Object.assign(task.execution, { dshSessionId: requestedSession, transport: 'dsh-session', phase: 'creating' })
          saveTask(task)
          const created = await withDeadline(() => controller.create({ cwd:task.projectDir,sessionId:requestedSession }),15000)
          id = typeof created === 'string' ? created : created?.sessionId ?? created?.id ?? created?.header?.id
          if (!id) throw new Error('DSH session create returned no sessionId')
          Object.assign(task.execution, { dshSessionId: id, phase: 'created' })
          saveTask(task)
        }
        const [baseline,targetState] = await Promise.all([readDshRunEvents(ctx,id),dshState(id)])
        const baselineSeq = baseline === null ? null : baseline.at(-1)?.seq ?? -1
        assertDshIdle(targetState,baseline ?? (resolvedTarget ? null : []),'target')
        await assertSourceIdle(task, stoppedSource)
        validateReferences(task.packet)
        const source = parseRollout(task.source.rolloutFile)
        if (source.error || messageDigest(normalizeMessages(source, task.source)) !== plan.sourceDigest) throw new Error('来源任务已变化，请刷新接力资料后确认')
        if (workspaceSnapshot(task.projectDir,{includeDiff:false}).digest !== workspaceDigest) throw new Error('确认后代码又发生变化，请刷新交接包')
        const requestId = `hs-${runId}`
        Object.assign(task.execution, { transport: 'dsh-session', dshSessionId: id, baselineSeq, requestId, phase: 'dispatching' })
        saveTask(task)
        const accepted = await withDeadline((signal) => controller.prompt({ requestId, sessionId:id, mode:'queue',
          content:[{ type:'text',text:renderPrompt(task.packet) }] },signal),30000)
        if (accepted?.accepted === false) { task.execution.phase = 'rejected'; throw new Error('DSH 未接受交接提示词') }
        task.links.dshSessionId = id
        delete task.retryDshSessionId
        task.execution.phase = 'accepted'
      }
      task.status = 'executing'; task.lastExecutedBy = effective
      updateRound(task, { status: 'executing', execution: task.execution, preflight: task.preflight })
      addRelay(task, { from: task.source.kind, to: effective, action: 'execute', revision: task.revision, note: task.execution.transport })
      saveTask(task)
      return task
    } catch (error) {
      if (!recorded) { releaseProject(project.id, lease); throw error }
      const ambiguous = ['creating','dispatching'].includes(task.execution?.phase) &&
        !['session/agent-busy','gateway/bad-request','session/not-found','session/not_found'].includes(error.code)
      if (!ambiguous && task.execution?.dshSessionId && !plan.targetSession && task.execution.phase !== 'creating') task.retryDshSessionId = task.execution.dshSessionId
      task.status = ambiguous ? 'unknown' : 'failed'; task.owner = ambiguous ? effective : 'none'; task.error = String(error.message)
      task.preflight = { ...task.preflight, status: task.preflight.status === 'passed' ? 'passed' : 'failed' }
      updateRound(task, { status: task.status, error: task.error, execution: task.execution })
      saveTask(task)
      if (!ambiguous) { releaseProject(project.id, lease); task.lease = null; saveTask(task) }
      throw error
    } finally {
      starting.delete(taskId)
    }
  }
  function settle(task, success, note, { text, checks = [], legacyPaths = [], failureCode = null } = {}) {
    task.status = success ? 'awaiting-review' : 'failed'; task.owner = 'none'; task.error = success ? null : note
    task.reception = receptionFor(task)
    task.execution.endedAt = new Date().toISOString()
    task.execution.note = note
    if (failureCode) task.execution.failureCode = failureCode
    task.verification = { status: 'not-reviewed', note: '进程结束不等于验收通过，请检查实际改动和测试' }
    const baseline = task.packet?.workspace
    let observed = { changedFiles: [], workspace: 'unavailable', checks }
    try {
      const snapshot = workspaceSnapshot(task.projectDir,{includeDiff:false})
      const before = new Map((baseline?.files ?? []).map((file) => [file.path, digest(file)]))
      const after = new Map(snapshot.files.map((file) => [file.path, digest(file)]))
      const changedFiles = [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file))
      const committed = changesBetweenCommits(task.projectDir, snapshot.gitRoot, baseline?.head, snapshot.head)
      observed = { changedFiles: [...new Set([...changedFiles, ...(committed ?? [])])], workspace: baseline?.digest === snapshot.digest ? 'unchanged' : 'changed', baseCommit: baseline?.head ?? null, endCommit: snapshot.head, endWorkspaceDigest:snapshot.digest, committedPathsAvailable: committed !== null, checks }
    } catch { /* retain the original execution outcome */ }
    const reported = parseReportedResult(text)
    task.result = { observed, reported, format: reported ? 'structured' : 'unstructured' }
    const target = task.execution.target
    if (legacyPaths.length) {
      task.edit ??= {}
      task.edit[target] = { files: legacyPaths.length, fileList: legacyPaths, lastAt: task.execution.endedAt }
      task.edit.lastEditor = target; task.edit.lastEditAt = task.execution.endedAt
    }
    updateRound(task, { status: task.status, execution: task.execution, reception: task.reception, verification: task.verification, result: task.result })
    addRelay(task, { from: task.execution.target, to: 'none', action: 'finish', revision: task.revision, note })
    saveTask(task)
    releaseProject(task.projectId, task.lease); task.lease = null; saveTask(task)
  }
  function receptionFor(task) {
    if (task.packet?.executionPlan?.mode === 'read-only' && task.execution && task.execution.phase !== 'intent') return { status: 'host-checked' }
    if (task.packet?.schema === PACKET_SCHEMA && !task.execution) return { status: 'pending' }
    return readReceipt(task.packet)
  }
  function markUnknown(task, note) {
    if (task.status === 'unknown' && task.error === note) return
    task.status = 'unknown'; task.error = note
    updateRound(task, { status: 'unknown', error: note, execution: task.execution })
    saveTask(task)
  }
  function finalizeCodex(task) {
    const execution = task.execution
    const events = readRunEvents(execution.logFile)
    const thread = events.find((event) => event.type === 'thread.started')
    const exactId = thread?.thread_id ?? thread?.threadId
    const expectedId = task.packet?.executionPlan?.targetSession
    if (expectedId && exactId && exactId !== expectedId) {
      if (!isPidAlive(execution.pid) || fs.existsSync(execution.resultFile ?? '')) {
        settle(task,false,'Codex 返回了其他会话，本轮结果未关联。请核对运行日志。')
      }
      return
    }
    if (exactId && execution.codexSessionId !== exactId) {
      execution.codexSessionId = exactId
      task.links ??= {}; task.links.codexSessionId = exactId
      updateRound(task, { execution }); saveTask(task)
    }
    let outcome
    try { outcome = JSON.parse(fs.readFileSync(execution.resultFile, 'utf8')) } catch {
      if (isPidAlive(execution.pid)) return
      const terminal = events.findLast((event) => ['turn.completed', 'turn.failed'].includes(event.type))
      if (!terminal || !exactId) { markUnknown(task, 'Codex 进程已退出，但缺少本轮结果。请检查会话和运行日志。'); return }
      outcome = { sessionId: exactId, exitCode: terminal.type === 'turn.completed' ? 0 : null, signal: terminal.type }
    }
    const id = outcome.sessionId ?? execution.codexSessionId
    if (expectedId && id !== expectedId) {
      settle(task,false,'Codex 返回了其他会话，本轮结果未关联。请核对运行日志。')
      return
    }
    let legacyPaths = []
    if (id) {
      execution.codexSessionId = id; task.links ??= {}; task.links.codexSessionId = id
      const file = findRunSessionFile(execution.startedAtMs ?? 0, { sessionId: id, projectDir: task.projectDir })
      if (file) {
        task.links.codexRolloutFile = file.file
        if (task.packet?.schema !== PACKET_SCHEMA) legacyPaths = parseRollout(file.file).toolPaths
      }
    }
    const items = events.filter((event) => event.type === 'item.completed').map((event) => event.item)
    const checks = items.filter((item) => item?.type === 'command_execution' && Number.isInteger(item.exit_code))
      .map((item) => ({ command:redact(item.command), exitCode:item.exit_code, itemId:item.id, ...(testCommand(item.command) ? { test:true } : {}) }))
    const text = items.findLast((item) => item?.type === 'agent_message')?.text
    const success = outcome.exitCode === 0 && !events.some((event) => event.type === 'turn.failed')
    if (success && !id) { markUnknown(task, 'Codex 未返回可关联的会话 ID，请检查运行日志。'); return }
    task.lastExecutedBy = 'codex'
    const occupied = !success && !exactId && codexWriterConflict(execution.logFile,expectedId)
    const interrupted = !success && events.some((event) => ['error','turn.failed'].includes(event.type) && isCodexUsageLimit(event.error, event.message))
    const note = success ? 'Codex 本轮结束，待核对回执与验收'
      : occupied ? writerConflictMessage
      : interrupted ? 'Codex 遇到用量限制，本轮已停止。可查看结果并接力到 DSH。'
      : `Codex 执行失败（${outcome.exitCode ?? outcome.signal ?? 'unknown'}），请查看运行日志`
    settle(task, success, note, { text, checks, legacyPaths, failureCode:occupied ? writerConflict : interrupted ? 'usage-limit' : null })
  }
  async function reconcileRuns() {
    const pending = loadTaskViews().filter((view) => active(view) && !starting.has(view.id))
    for (let offset = 0; offset < pending.length; offset += 4) {
      await Promise.all(pending.slice(offset,offset + 4).map(reconcileRun))
    }
  }
  async function reconcileRun(view) {
    const task = loadTask(view.id)
    if (!active(task) || (task.status === 'preparing' && task.lease?.hostPid !== process.pid && isPidAlive(task.lease?.hostPid))) return
    try {
      if (task.status === 'preparing' && task.execution?.phase === 'intent') {
        settle(task, false, '上次启动在发送前中断，可以重新确认。')
      } else if (task.execution?.transport === 'codex-exec') {
        finalizeCodex(task)
      } else if (task.execution?.transport === 'dsh-session') {
        const execution = task.execution
        const id = execution.dshSessionId
        const [state, events] = await Promise.all([dshState(id), readDshRunEvents(ctx, id)])
        const current = loadTask(task.id)
        if (!active(current) || current.execution?.runId !== execution.runId || current.lease?.nonce !== task.lease?.nonce) return
        if (execution.phase === 'created' || (execution.phase === 'creating' && state.known && !state.running)) {
          task.retryDshSessionId = id
          settle(task, false, '上次只创建了会话，未发送接力任务，可以重新确认。')
          return
        }
        if (execution.phase === 'creating') {
          markUnknown(task,'尚未确认目标 DSH 会话是否已创建，请核对后再试。')
          return
        }
          const observed = observeDshRequest(events, execution.requestId, execution.baselineSeq)
        if (observed.finish) {
          task.links ??= {}; task.links.dshSessionId = id; task.lastExecutedBy = 'dsh'
          const reason = observed.finish
          const success = reason.kind === 'completed'
          const text = harvest(observed.evidence).assistantTexts.at(-1)
          const checks = observed.evidence.filter((event) => event.type === 'tool/result').flatMap((event) => {
            const message = event.data?.message
            if (typeof message?.toolName !== 'string') return []
            return [{ tool: message.toolName, status: message.isError ? 'error' : 'returned', eventSeq: event.seq }]
          })
          execution.turn = observed.turn
            const providerError = {
              AUTH:'模型服务认证失败。请在 DSH 检查当前模型的登录或密钥，再重试。',
              MISSING_CREDENTIAL:'模型服务缺少凭据。请在 DSH 完成模型配置，再重试。',
              QUOTA:'模型服务报告额度或余额不足。请在 DSH 确认额度恢复后再重试，也可接回 Codex。',
              RATE_LIMIT:'模型服务限制了请求频率。请稍等再重试。',
            }[reason.error?.code]
          settle(task, success, success ? 'DSH 本轮已结束，待验收' : `DSH 本轮失败：${providerError ?? reason.kind}`, { text, checks, failureCode:reason.error?.code })
        } else if (observed.receipt || state.queue?.some((entry) => entry.rpcId === execution.requestId)) {
          if (task.status !== 'executing' || execution.turn !== observed.turn) {
            task.status = 'executing'; task.error = null; execution.turn = observed.turn; execution.phase = 'accepted'; task.lastExecutedBy = 'dsh'
            task.links ??= {}; task.links.dshSessionId = id
            updateRound(task, { status: 'executing', execution }); saveTask(task)
          }
          if (observed.receipt && state.known && !state.running) markUnknown(task, '已找到 DSH 请求，尚未确认该回合如何结束。')
        } else if (task.status === 'preparing' || (!state.running && Date.now() - execution.startedAtMs > 15000)) {
          markUnknown(task, '尚未确认 DSH 本轮请求或结束事件，请核对目标会话。')
        }
      } else {
        markUnknown(task, '缺少可关联的执行记录，请检查原客户端。')
      }
    } catch { /* one unreachable session cannot break the board */ }
  }
  function finalizeTasks() {
    observing ??= reconcileRuns().finally(() => { observing = null })
    return observing
  }
  function refreshCandidates() {
    candidateRefresh ??= (async () => {
      const [dsh,codex] = await Promise.all([
        listDshSessions(ctx), Promise.resolve().then(() => listCodexThreads(200)),
      ])
      names = { codex: codexProjectNames(), dsh: dshProjectNames(ctx) }
      const gitRoots = new Map()
      const commonDir = (dir) => {
        if (!gitRoots.has(dir)) gitRoots.set(dir, gitCommonDir(dir))
        return gitRoots.get(dir)
      }
      for (const { projects } of Object.values(names)) for (const item of projects) {
        item.gitRoots = gitRoots
        for (const root of item.roots) {
          if (typeof root !== 'string' || !path.isAbsolute(root)) continue
          commonDir(fileIdentity(root))
        }
      }
      const projects = listProjects()
      const byDirectory = new Map()
      const decorate = (kind, rows) => rows.filter((row) => row.projectDir).map((row) => {
        let project = byDirectory.get(row.projectDir)
        if (!project) {
          project = resolveProject(row.projectDir, projects, commonDir)
          byDirectory.set(row.projectDir, project)
        }
        return { ...row, kind, projectId: project.id, projectName: projectLabel(kind, row.sessionId, row.projectDir, project) ?? path.basename(row.projectDir) }
      })
      candidateSnapshot = { dsh: decorate('dsh', dsh), codex: decorate('codex', codex) }
      return candidateSnapshot
    })().finally(() => { candidateRefresh = null })
    return candidateRefresh
  }
  function startObserver() {
    background = true
    const scan = () => { void refreshCandidates().catch(() => {}) }
    const observe = () => { void finalizeTasks().catch(() => {}); if (!candidateSnapshot) scan() }
    observe()
    const runs = setInterval(observe, 2000), candidates = setInterval(scan, 15000)
    runs.unref?.(); candidates.unref?.()
    return () => { clearInterval(runs); clearInterval(candidates); background = false }
  }
  async function board({ refresh = false } = {}) {
    if (!background) await finalizeTasks()
    const candidates = refresh || !background || !candidateSnapshot ? await refreshCandidates() : candidateSnapshot
    const all = loadTaskViews().filter((task) => task.projectDir && !task.previewOnly).map((task) => task.previewPrevious ?? task)
    const records = listProjects()
    const projects = new Map(records.map((project) => [project.id, project]))
    const tasks = new Map()
    const legacyProjects = new Map()
    const findProject = (task) => {
      const existing = projects.get(task.projectId) ?? legacyProjects.get(task.projectDir)
      if (existing) return existing
      const project = resolveProject(task.projectDir, records)
      legacyProjects.set(task.projectDir, project)
      projects.set(project.id, project)
      return project
    }
    const history = []
    for (const task of all) {
      const project = findProject(task)
      if (historyTask(task)) {
        history.push(present(task, project))
        continue
      }
      const selected = tasks.get(project.id)
      if (!selected || (taskRank[task.status] ?? 0) > (taskRank[selected.status] ?? 0)) tasks.set(project.id, task)
    }
    const used = { codex: new Set(), dsh: new Set() }
    for (const task of all) for (const entry of [task, ...(task.rounds ?? [])]) {
      for (const kind of ['codex','dsh']) {
        const key = `${kind}SessionId`
        const source = entry.source?.kind === kind && (entry.source[key] ?? entry.source.sessionId)
        for (const id of [source, entry.links?.[key], entry.execution?.[key]]) if (id) used[kind].add(normalizeId(id))
      }
    }
    const grouped = ['codex','dsh'].flatMap((kind) => groupProjects(candidates[kind].filter((row) => !used[kind].has(normalizeId(row.sessionId)))))
    const byProject = new Map()
    for (const row of grouped) {
      const sources = byProject.get(row.projectId) ?? []
      sources.push(row); byProject.set(row.projectId, sources)
    }
    const columns = { codex: [], dsh: [] }
    for (const sources of byProject.values()) {
      sources.sort((a,b) => activityTime(b.lastActivity) - activityTime(a.lastActivity))
      const top = sources[0]
      if (!tasks.has(top.projectId) && !projects.get(top.projectId)?.hiddenAt) columns[top.kind].push({ ...top, sources })
    }
    for (const rows of Object.values(columns)) rows.sort((a,b) => activityTime(b.lastActivity) - activityTime(a.lastActivity))
    return { ok: true, home: storeRoot(),
      tasks: [...tasks].map(([id, task]) => ({ ...present(task, projects.get(id)),
        additionalSources: projects.get(id)?.hiddenAt ? [] : byProject.get(id) ?? [] })),
      history,
      hiddenProjects: [...projects.values()].filter((project) => project.hiddenAt).map((project) => ({
        id: project.id, name: byProject.get(project.id)?.[0]?.projectName ?? projectLabel('codex', null, project.primaryDir, project) ?? projectLabel('dsh', null, project.primaryDir, project) ?? project.name,
      })),
      codexThreads: columns.codex, dshSessions: columns.dsh, capabilities: capabilities() }
  }
  function taskDetail(id) {
    const task = ownTask(id)
    const project = (task.projectId && readProject(task.projectId)) || resolveProject(task.projectDir)
    const summary = present(task, project)
    if (hasWriterConflict(task)) {
      summary.failureCode = writerConflict
      summary.error = writerConflictMessage
    }
    task.reception = summary.reception
    const relatedTasks = loadTaskViews().filter((record) => record.id !== id && sameProject(record, project)).map((record) => present(record, project))
    return { ok: true, task, taskSummary:summary, project, relatedTasks, review:reviewView(task), promptPreview: task.packet ? renderPrompt(task.packet) : '', capabilities: capabilities() }
  }
  function updateTask({ taskId, patch = {} }) {
    const task = ownTask(taskId)
    if (active(task)) throw new Error('执行中的任务须先结束本轮，不能手动覆盖运行状态')
    if (patch.title?.trim()) task.title = patch.title.trim()
    if (['done','failed','awaiting-review'].includes(patch.status)) {
      task.status = patch.status
      if (patch.status === 'done') task.verification = { status: 'user-reviewed', at: new Date().toISOString(), note: patch.note ?? '用户标记完成' }
      updateRound(task, { status: task.status, verification: task.verification })
    }
    if (patch.note) addRelay(task, { from: 'user', to: 'none', action: 'note', note: patch.note })
    return saveTask(task)
  }
  function archiveTask({ taskId, revision, runId, restore = false }) {
    const task = ownTask(taskId)
    if (active(task) || task.revision !== revision || (task.execution?.runId ?? null) !== runId) throw new Error('接力状态已变化，请刷新后再操作')
    if (restore) {
      if (!historyTask(task)) return task
      delete task.archivedAt
      task.restoredAt = new Date().toISOString()
    } else {
      if (task.archivedAt) return task
      if (task.status === 'awaiting-review') {
        task.status = 'done'
        task.verification = { status: 'user-reviewed', at: new Date().toISOString(), note: '用户确认并归档' }
        updateRound(task, { status: 'done', verification: task.verification })
      }
      task.archivedAt = new Date().toISOString()
    }
    return saveTask(task)
  }
  function hideProject({ projectId, hidden }) {
    const project = readProject(projectId)
    if (!project || typeof hidden !== 'boolean') throw new Error('无法更新该项目的显示状态')
    if (hidden) project.hiddenAt ??= new Date().toISOString()
    else delete project.hiddenAt
    return saveProject(project)
  }
  async function releaseUnconfirmed({ taskId, runId }) {
    await finalizeTasks()
    const task = ownTask(taskId)
    const run = task.execution
    if (task.status !== 'unknown' || (run?.runId ?? null) !== runId) throw new Error('执行状态已变化，请刷新卡片')
    if (run?.target === 'dsh' || run?.transport === 'dsh-session') {
      const state = await dshState(run.dshSessionId)
      if (!state.known || state.running || state.queue?.length) throw new Error('尚未确认目标 DSH 会话和队列已停止')
    } else if (isPidAlive(run?.pid)) throw new Error('Codex 进程仍在运行')
    const current = ownTask(taskId)
    if (current.status !== 'unknown' || (current.execution?.runId ?? null) !== runId) throw new Error('执行状态已变化，请刷新卡片')
    current.execution ??= { target: current.target }
    if (current.execution.dshSessionId && !current.packet?.executionPlan?.targetSession) current.retryDshSessionId = current.execution.dshSessionId
    settle(current, false, '用户核对后结束状态待核实的运行。重试需要重新确认。')
    return current
  }
  async function runStatus(taskId) {
    await finalizeTasks()
    return taskDetail(taskId)
  }
  function deleteTask(id) {
    const task = ownTask(id)
    const project = resolveProject(task.projectDir)
    const records = loadAllTasks().filter((item) => sameProject(item,project))
    if (records.some(active)) throw new Error('executing task cannot be deleted')
    // This is a project-card action. Preserve each task and its original ID in the archive.
    const directory = path.join(storeRoot(),'history','removed-cards',`${task.id}-${Date.now()}`)
    fs.mkdirSync(directory,{recursive:true,mode:0o700})
    for (const record of records) fs.writeFileSync(path.join(directory,`${record.id}.json`),JSON.stringify(record,null,2),{mode:0o600})
    for (const record of records) storeDeleteTask(record.id)
    return true
  }
  function updateProject({ projectId, patch }) {
    const project = readProject(projectId)
    if (!project) throw new Error('project not found')
    if (loadAllTasks().some((task) => sameProject(task,project) && active(task))) throw new Error('执行中不能修改项目主档')
    return updateMaster(projectId, patch ?? {})
  }
  function acknowledge({ taskId, revision, packetDigest }, receivingSessionId) {
    const task = ownTask(taskId)
    if (!task.packet?.manifestPath) throw new Error('请先升级并刷新交接包')
    if (revision !== task.revision || packetDigest !== task.packet.digest) throw new Error('读取回执必须对应本轮版本与摘要')
    const run = task.execution
    if (!active(task) || run?.target !== 'dsh' || !['dispatching','accepted'].includes(run.phase) ||
      !receivingSessionId || normalizeId(receivingSessionId) !== normalizeId(run.dshSessionId)) {
      throw new Error('只有正在接收这一轮的 DSH 会话可以生成回执')
    }
    writeReceipt(task.packet.manifestPath)
    // The receipt file is the only write here. The observer reads it without
    // letting a late acknowledgement overwrite execution state.
    return readReceipt(task.packet)
  }
  return { convertDsh, convertCodex, refreshTask, checkTask, inspectTask, materials, discardPreview, setSharing, clarify, prepareNext, executeTask, board, taskDetail, runStatus, updateTask, deleteTask, archiveTask, hideProject, replaceMissingTarget,
    finalizeTasks, startObserver, openCodex, openDsh, reviewTask, cloudPlan, releaseUnconfirmed, updateProject, acknowledge, runLogPath, renderPrompt }
}
