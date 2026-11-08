/** Project cards are durable; each handoff is a separate immutable round. */
import fs from 'node:fs'
import path from 'node:path'
import { createTask, loadTask, saveTask, deleteTask as storeDeleteTask, loadAllTasks, taskSummary, addRelay, storeRoot, runLogPath } from './store.js'
import { buildPacket, renderPrompt } from './packet.js'
import { extractDshContext, listDshSessions } from './dsh-session.js'
import { parseRollout, listCodexThreads, findRunSessionFile, pickTaskText, taskTitle } from './codex.js'
import { executeWithFallback, isPidAlive, resolveCodexBinary } from './executor.js'
import { sessionId as normalizeId, fileIdentity, groupProjects } from './identity.js'
import { resolveProject, readProject, saveProject, updateProject as updateMaster, projectTask, sameProject, acquireProject, releaseProject, activeProjectTask } from './projects.js'
import { workspaceSnapshot, digest } from './workspace.js'
import { captureContext, normalizeMessages, redact } from './context.js'
import { readReceipt, validateReferences, writeReceipt } from './receipt.js'

function get(ctx, name) { try { return ctx?.get?.(name) } catch { return undefined } }
const opposite = (kind) => kind === 'codex' ? 'dsh' : 'codex'
const active = (task) => ['preparing','executing'].includes(task?.status)
const roundOf = (task) => task.rounds?.find((round) => round.revision === task.revision)
function updateRound(task, fields) { const round = roundOf(task); if (round) Object.assign(round, fields) }
function ownTask(id) { const task = loadTask(id); if (!task) throw new Error('task not found'); return task }

export function createCore(ctx, config = {}) {
  const conversions = new Map(), executions = new Map()
  const serialize = (map, key, fn) => {
    if (map.has(key)) return map.get(key)
    const pending = Promise.resolve().then(fn).finally(() => map.delete(key)); map.set(key, pending); return pending
  }
  function capabilities() {
    const binary = resolveCodexBinary(config)
    let codex = false
    try { fs.accessSync(binary.bin, fs.constants.X_OK); codex = true } catch { /* report unavailable */ }
    const controller = get(ctx, 'sessionController')
    return { codex: { available: codex, binary: binary.bin, transport: 'bundled-exec', receipt: 'local-file' },
      dsh: { available: typeof controller?.create === 'function' && typeof controller?.prompt === 'function', receipt: 'handshake acknowledge tool or local-file' },
      sourceModelRequired: false, notes: ['目标端须使用自身可用工具；源端工具名不是目标端能力保证。'] }
  }
  function stage(source, info, { force = false, taskId } = {}) {
    const cwd = info.projectDir
    if (!cwd) throw new Error('会话缺少实际项目目录')
    const project = resolveProject(cwd)
    let task = taskId ? ownTask(taskId) : projectTask(project)
    if (task && !sameProject(task, project)) throw new Error('项目身份不一致')
    if (active(task) || activeProjectTask(project, task?.id)) throw new Error('该项目仍在执行，请等待本轮结束后再接力')
    const messages = normalizeMessages(info, source)
    if (!messages.length) throw new Error('没有可交接的上下文')
    const snapshot = workspaceSnapshot(project.primaryDir || cwd)
    const fingerprint = digest({ sourceId: [source.kind, source.sessionId ?? source.codexSessionId], messages: messages.map(({ role, text, seq, at }) => ({ role, text, seq, at })), snapshot: snapshot.digest, masterRevision: project.masterRevision ?? 0 })
    if (['staged','failed'].includes(task?.status) && task.contextFingerprint === fingerprint && !force) return task
    if (!task) task = createTask({ title: info.title || taskTitle(info.goal), projectDir: cwd, source }, { persist: false })
    // Preserve the pre-upgrade record before adding the round protocol.
    if (!task.rounds) {
      const dir = path.join(storeRoot(), 'history'); fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${task.id}-legacy.json`)
      if (task.packet && !fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(task, null, 2), { mode: 0o600 })
      task.rounds = []
    }
    updateRound(task, { status: task.status === 'staged' ? 'superseded' : task.status, endedAt: new Date().toISOString() })
    task.projectId = project.id
    task.projectDir = snapshot.cwd
    task.source = source
    task.title = info.title || task.title
    task.revision = (task.revision ?? 0) + 1
    task.target = opposite(source.kind)
    task.links ??= {}
    if (source.kind === 'codex') {
      task.links.codexSessionId = source.codexSessionId
      task.links.codexRolloutFile = source.rolloutFile
    } else task.links.dshSessionId = source.sessionId
    const context = captureContext(task, project, { ...info, messages }, snapshot, task.revision)
    task.packet = buildPacket({ ...context, taskId: task.id, projectId: project.id, revision: task.revision,
      masterRevision: project.masterRevision ?? 0, from: source.kind, fromSessionId: source.sessionId ?? source.codexSessionId,
      title: task.title, projectDir: task.projectDir, target: task.target, capabilities: capabilities(), relay: task.relay })
    fs.writeFileSync(task.packet.manifestPath, JSON.stringify(task.packet, null, 2), { mode: 0o600 })
    task.contextFingerprint = fingerprint
    task.status = 'staged'; task.owner = 'none'; task.error = null; task.execution = null; task.lease = null
    task.reception = readReceipt(task.packet)
    task.rounds.push({ revision: task.revision, from: source.kind, to: task.target, source, status: 'staged',
      packetPath: task.packet.manifestPath, packetDigest: task.packet.digest, workspaceDigest: snapshot.digest, createdAt: new Date().toISOString() })
    task.edit ??= { dsh: {}, codex: {} }
    task.edit[source.kind] = { files: snapshot.files.length, fileList: snapshot.files.map((file) => file.path), lastAt: new Date().toISOString() }
    task.edit.lastEditor = source.kind; task.edit.lastEditAt = task.edit[source.kind].lastAt
    addRelay(task, { from: source.kind, to: task.target, action: 'prepare', revision: task.revision, note: `第 ${task.revision} 轮，完整用户证据 ${context.coverage.userMessages} 条` })
    saveTask(task)
    return task
  }
  function convertCodex({ rolloutFile, taskId, force = false }) {
    if (!rolloutFile) throw new Error('rolloutFile is required')
    const info = parseRollout(rolloutFile)
    if (info.error) throw new Error(info.error)
    info.goal = pickTaskText(info.userTexts)
    info.title = taskTitle(info.goal) || 'Codex 接力任务'
    return stage({ kind: 'codex', rolloutFile: fileIdentity(rolloutFile), codexSessionId: info.sessionId }, info, { taskId, force })
  }
  function convertDsh({ sessionId, taskId, force = false }) {
    const id = normalizeId(sessionId)
    if (!id) return Promise.reject(new Error('sessionId is required'))
    return serialize(conversions, `dsh:${id}`, async () => {
      const info = await extractDshContext(ctx, id)
      return stage({ kind: 'dsh', sessionId: id }, info, { taskId, force })
    })
  }
  async function refreshTask({ taskId }) {
    const task = ownTask(taskId)
    return task.source.kind === 'codex' ? convertCodex({ rolloutFile: task.source.rolloutFile, taskId }) : convertDsh({ sessionId: task.source.sessionId, taskId })
  }
  async function prepareNext({ taskId, sourceKind }) {
    await finalizeTasks()
    const task = ownTask(taskId)
    if (active(task)) throw new Error('当前轮仍在执行，不能切换接力方')
    const kind = sourceKind ?? task.lastExecutedBy ?? task.source.kind
    if (!['codex','dsh'].includes(kind)) throw new Error('unknown source kind')
    const completedRevision = task.rounds?.filter((round) => round.execution).at(-1)?.revision ?? 0
    if (task.status === 'staged' && task.preparedFromRun === completedRevision && task.source.kind === kind) return refreshTask({ taskId })
    const remember = (prepared) => { prepared.preparedFromRun = completedRevision; return saveTask(prepared) }
    if (kind === 'codex') {
      const file = task.links?.codexRolloutFile ?? (task.source.kind === 'codex' ? task.source.rolloutFile : null)
      if (!file) throw new Error('未找到本轮 Codex 会话，请先检查执行日志')
      return remember(convertCodex({ rolloutFile: file, taskId, force: true }))
    }
    const id = task.links?.dshSessionId ?? (task.source.kind === 'dsh' ? task.source.sessionId : null)
    if (!id) throw new Error('未找到本轮 DSH 会话')
    return remember(await convertDsh({ sessionId: id, taskId, force: true }))
  }
  async function dshState(id) {
    const registry = get(ctx, 'agents')
    const agent = registry?.get?.(id) ?? registry?.get?.(`session-${normalizeId(id)}`) ?? registry?.get?.(normalizeId(id))
    if (agent) return { running: agent.status === 'running', known: true }
    const controller = get(ctx, 'sessionController')
    if (typeof controller?.state === 'function') {
      try { return { ...await controller.state({ sessionId: id }, AbortSignal.timeout(5000)), known: true } } catch { /* raw logs fallback */ }
    }
    return { known: false, running: false }
  }
  async function assertSourceIdle(task) {
    if (task.source.kind === 'dsh') {
      if ((await dshState(task.source.sessionId)).running) throw new Error('源 DSH 会话仍在运行，请先在 DSH 停止或等待本轮结束')
    } else {
      const parsed = parseRollout(task.source.rolloutFile)
      if (parsed.running) throw new Error('源 Codex 会话仍在运行，请先停止或等待本轮结束')
    }
  }
  function executeTask(args) {
    return serialize(executions, args.taskId, () => executeOnce(args))
  }
  async function executeOnce({ taskId, target, expectedRevision }) {
    let task = ownTask(taskId)
    if (!['staged','failed'].includes(task.status)) throw new Error('仅待执行或失败的任务可以启动')
    if (expectedRevision !== undefined && task.revision !== expectedRevision) throw new Error('交接版本已变化，请重新核对后确认')
    const oldRevision = task.revision
    task = await refreshTask({ taskId })
    if (task.revision !== oldRevision) throw new Error(`交接包已更新为第 ${task.revision} 轮，请核对最新资料后再次确认`)
    const effective = target ?? task.target
    if (!['dsh','codex'].includes(effective)) throw new Error('unknown execute target')
    if (effective !== task.target) throw new Error('执行方向与本轮交接包不一致，请重新准备交接')
    const project = readProject(task.projectId)
    if (activeProjectTask(project, task.id)) throw new Error('该项目已有执行中的接力任务')
    await assertSourceIdle(task)
    const available = capabilities()[effective]
    if (!available.available) throw new Error(`${effective} 执行能力不可用，请检查客户端运行时`)
    const lease = acquireProject(project, task.id, task.revision, effective)
    task.status = 'preparing'; task.owner = effective; task.lease = lease; task.error = null
    task.preflight = { status: 'checking', checkedAt: new Date().toISOString() }
    saveTask(task)
    try {
      validateReferences(task.packet)
      const snapshot = workspaceSnapshot(task.projectDir)
      if (snapshot.digest !== task.packet.workspace.digest) throw new Error('确认后代码又发生变化，请刷新交接包')
      task.preflight = { status: 'passed', workspaceDigest: snapshot.digest, checkedAt: new Date().toISOString(), capabilities: available }
      if (effective === 'codex') {
        // Preserve the round's source and linked destination, not the original task's first direction.
        const input = { ...task, execution: { codexSessionId: task.links?.codexSessionId }, runId: `${task.id}-r${task.revision}` }
        task.execution = { ...await executeWithFallback(input, config), target: 'codex' }
      } else {
        const controller = get(ctx, 'sessionController')
        let id = task.links?.dshSessionId
        if (id && (await dshState(id)).running) throw new Error('目标 DSH 会话仍在运行')
        if (id) {
          try {
            const existing = await get(ctx,'sessionQuery')?.readSession?.(id)
            const existingDir = existing?.session?.cwd ?? existing?.header?.cwd
            if (existingDir && fileIdentity(existingDir) !== task.projectDir) id = null
          } catch { /* reuse the known link unless a directory mismatch is proven */ }
        }
        if (!id) {
          const created = await controller.create({ cwd: task.projectDir })
          id = typeof created === 'string' ? created : created?.sessionId ?? created?.id ?? created?.header?.id
          if (!id) throw new Error('DSH session create returned no sessionId')
          task.links.dshSessionId = id
          saveTask(task) // retry keeps this session, including a host restart between create and prompt
        }
        let baselineSeq = -1
        try { baselineSeq = (await get(ctx,'sessionQuery')?.readSession?.(id))?.events?.at(-1)?.seq ?? -1 } catch { /* observation optional */ }
        const accepted = await controller.prompt({ requestId: `hs-${task.id}-r${task.revision}`, sessionId: id, mode: 'queue',
          content: [{ type: 'text', text: renderPrompt(task.packet) }] }, AbortSignal.timeout(30000))
        if (accepted?.accepted === false) throw new Error('DSH 未接受交接提示词')
        task.execution = { transport: 'dsh-session', target: 'dsh', dshSessionId: id, baselineSeq, startedAt: new Date().toISOString(), startedAtMs: Date.now() }
      }
      task.status = 'executing'; task.lastExecutedBy = effective
      updateRound(task, { status: 'executing', execution: task.execution, preflight: task.preflight })
      addRelay(task, { from: task.source.kind, to: effective, action: 'execute', revision: task.revision, note: task.execution.transport })
      saveTask(task)
      return task
    } catch (error) {
      task.status = 'failed'; task.owner = 'none'; task.error = String(error.message)
      task.preflight = { ...task.preflight, status: task.preflight.status === 'passed' ? 'passed' : 'failed' }
      updateRound(task, { status: 'failed', error: task.error })
      releaseProject(project.id, lease); task.lease = null; saveTask(task); throw error
    }
  }
  function settle(task, success, note) {
    task.status = success ? 'awaiting-review' : 'failed'; task.owner = 'none'; task.error = success ? null : note
    task.reception = readReceipt(task.packet)
    task.execution.endedAt = new Date().toISOString()
    task.execution.note = note
    task.verification = { status: 'not-reviewed', note: '进程结束不等于验收通过，请检查实际改动和测试' }
    updateRound(task, { status: task.status, execution: task.execution, reception: task.reception, verification: task.verification })
    addRelay(task, { from: task.execution.target, to: 'none', action: 'finish', revision: task.revision, note })
    releaseProject(task.projectId, task.lease); task.lease = null; saveTask(task)
  }
  function finalizeCodex(task) {
    const execution = task.execution
    let outcome
    try { outcome = JSON.parse(fs.readFileSync(execution.resultFile, 'utf8')) } catch { return }
    const id = outcome.sessionId ?? execution.codexSessionId
    if (id) {
      execution.codexSessionId = id; task.links ??= {}; task.links.codexSessionId = id
      const file = findRunSessionFile(execution.startedAtMs ?? 0, { sessionId: id, projectDir: task.projectDir })
      if (file) {
        task.links.codexRolloutFile = file.file
        const parsed = parseRollout(file.file)
        task.edit.codex = { files: parsed.toolPaths.length, fileList: parsed.toolPaths, lastAt: new Date(file.mtimeMs).toISOString() }
        task.edit.lastEditor = 'codex'; task.edit.lastEditAt = task.edit.codex.lastAt
      }
    }
    settle(task, outcome.exitCode === 0, outcome.exitCode === 0 ? 'Codex 本轮结束，待核对回执与验收' : `Codex 退出码 ${outcome.exitCode ?? outcome.signal ?? 'unknown'}，请查看运行日志`)
  }
  async function finalizeTasks() {
    for (const task of loadAllTasks()) {
      if (task.status !== 'executing') continue
      try {
        if (task.execution?.transport === 'codex-exec') {
          if (fs.existsSync(task.execution.resultFile ?? '')) finalizeCodex(task)
          else if (!isPidAlive(task.execution.pid)) settle(task, false, '运行进程已结束但没有结果记录，请检查日志')
        } else if (task.execution?.transport === 'dsh-session') {
          task.reception = readReceipt(task.packet)
          const id = task.execution.dshSessionId
          const state = await dshState(id)
          let events = []
          try { events = (await get(ctx,'sessionQuery')?.readSession?.(id))?.events ?? [] } catch { /* preserve running until evidence arrives */ }
          const ended = events.some((event) => event.type === 'turn/end' && event.seq > (task.execution.baselineSeq ?? Infinity))
          if (ended && !state.running) settle(task, true, 'DSH 本轮已结束，待验收')
          else saveTask(task)
        }
      } catch { /* one unreachable session cannot break the board */ }
    }
  }
  async function board() {
    await finalizeTasks()
    const all = loadAllTasks()
    const projects = new Map()
    const tasks = new Map()
    for (const task of all) {
      if (!task.projectDir) continue
      const project = resolveProject(task.projectDir); projects.set(project.id, project)
      const selected = projectTask(project)
      if (selected) tasks.set(project.id, selected)
    }
    const used = new Set(tasks.keys())
    const usedDsh = new Set(all.flatMap((task) => [task.source?.kind === 'dsh' ? task.source.sessionId : null, task.links?.dshSessionId, task.execution?.dshSessionId]).filter(Boolean).map(normalizeId))
    const decorate = (rows) => rows.map((row) => { const project = resolveProject(row.projectDir); return { ...row, projectId: project.id } }).filter((row) => !used.has(row.projectId))
    const codex = decorate(listCodexThreads(200).filter((row) => row.projectDir))
    const dsh = decorate((await listDshSessions(ctx, usedDsh)).filter((row) => row.projectDir))
    const limit = Math.max(1,Math.min(200,Number(config.threadLimit) || 40))
    return { ok: true, home: storeRoot(), tasks: [...tasks.values()].map((task) => taskSummary({ ...task, reception: readReceipt(task.packet) })),
      codexThreads: groupProjects(codex).slice(0,limit), dshSessions: groupProjects(dsh).slice(0,limit), capabilities: capabilities() }
  }
  function taskDetail(id) {
    const task = ownTask(id)
    task.reception = readReceipt(task.packet)
    return { ok: true, task, project: task.projectId ? readProject(task.projectId) : resolveProject(task.projectDir), promptPreview: renderPrompt(task.packet), capabilities: capabilities() }
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
  function deleteTask(id) {
    const task = ownTask(id)
    const project = resolveProject(task.projectDir)
    const records = loadAllTasks().filter((item) => sameProject(item,project))
    if (records.some(active)) throw new Error('executing task cannot be deleted')
    // Archive all historical duplicates together so deleting a card cannot uncover an older copy.
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
  function acknowledge({ taskId, revision, packetDigest }) {
    const task = ownTask(taskId)
    if (!task.packet?.manifestPath) throw new Error('请先升级并刷新交接包')
    if (revision !== task.revision || packetDigest !== task.packet.digest) throw new Error('读取回执必须对应本轮版本与摘要')
    writeReceipt(task.packet.manifestPath)
    task.reception = readReceipt(task.packet); updateRound(task, { reception: task.reception }); saveTask(task)
    return task.reception
  }
  return { convertDsh, convertCodex, refreshTask, prepareNext, executeTask, board, taskDetail, updateTask, deleteTask,
    finalizeTasks, updateProject, acknowledge, runLogPath, renderPrompt }
}
