/** Isolated contract/regression suite. Never reads or writes the user's real sessions. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import http from 'node:http'
import { once } from 'node:events'

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'handshake-test-')))
process.env.DSH_HANDSHAKE_TEST_HOME = sandbox
const project = path.join(sandbox, 'project with spaces')
fs.mkdirSync(project)
after(() => fs.rmSync(sandbox, { recursive: true, force: true }))
const store = await import('../host/store.js')
const { createCore } = await import('../host/core.js')
const { listDshSessions, extractDshContext } = await import('../host/dsh-session.js')
const { parseRollout, listCodexThreads, pickTaskText, taskTitle } = await import('../host/codex.js')
const { executeToCodex } = await import('../host/executor.js')
const { renderPrompt } = await import('../host/packet.js')
const { registerRoutes } = await import('../host/routes.js')
const { groupProjects, projectKey } = await import('../host/identity.js')
const ctxFor = (services = {}) => ({ get: (key) => services[key] })
const fresh = () => fs.rmSync(path.join(sandbox, '.dsh-handshake'), { recursive: true, force: true })
const codexDir = path.join(sandbox, '.codex', 'sessions', '2026', '11', '08')
fs.mkdirSync(codexDir, { recursive: true })
function rollout(id, name = id) {
  const file = path.join(codexDir, `rollout-${name}.jsonl`)
  fs.writeFileSync(file, [
    { type: 'session_meta', payload: { id, cwd: project, base_instructions: 'x'.repeat(20000) } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>seed</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `完成任务 ${id}` }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'apply_patch', arguments: JSON.stringify({ path: path.join(project, `${id}.js`) }) } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `最近进展 ${id}` }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `补充要求：保持 API 兼容 ${id}` }] } },
  ].map(JSON.stringify).join('\n') + '\n')
  return file
}
const sourceFile = rollout('codex-source')
const sourceCopy = rollout('codex-source', 'source-copy')
const otherFile = rollout('codex-other')
const dshDir = path.join(sandbox, '.dsh', 'sessions', 'encoded-group', 'session-dsh-source')
fs.mkdirSync(dshDir, { recursive: true })
const events = [
  { type: 'session', id: 'session-dsh-source', cwd: project },
  { type: 'session/title', data: { title: 'DSH 测试任务' } },
  { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '完成 DSH 任务' }] } },
  { type: 'assistant/message', data: { role: 'assistant', content: [{ type: 'text', text: '最新结论在第二个压缩帧之后' }] } },
  { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '补充要求：不要修改登录接口' }] } },
]
fs.writeFileSync(path.join(dshDir, 'session.v4.jsonl.zstd'), Buffer.concat(events.map((e) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(e) + '\n')))))
const query = {
  async listSessions() { return [
    { header: { id: 'session-dsh-source', cwd: project }, updatedAt: '2026-11-08T10:00:00Z' },
    { header: { id: 'dsh-source', cwd: project }, updatedAt: '2026-11-08T09:00:00Z' },
    { header: { id: 'session-dsh-other', cwd: project } },
    { header: { id: 'session-dsh-destination', cwd: project } },
  ] },
  async readTitle(id) { return `任务 ${id}` },
  async readSession(id) { assert.equal(id, 'session-dsh-source'); return { session: { id, cwd: project }, events } },
  async listEvents() { return [{ type: 'user/message', seq: 0 }] },
}
const stub = path.join(sandbox, 'codex-stub')
fs.writeFileSync(stub, '#!/bin/sh\ncat > "$DSH_HANDSHAKE_TEST_HOME/prompt.txt"\nprintf "%s\\n" "$@" > "$DSH_HANDSHAKE_TEST_HOME/args.txt"\npwd > "$DSH_HANDSHAKE_TEST_HOME/cwd.txt"\necho \'{"type":"thread.started","thread_id":"codex-run"}\'\nsleep 0.1\nexit 0\n')
fs.chmodSync(stub, 0o755)
async function waitForResult(task) {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(task.execution.resultFile)) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.fail('Executor result did not arrive')
}

test('DSH concatenated zstd frames retain goal, newest progress, title and actual cwd', async () => {
  const info = await extractDshContext(ctxFor(), 'dsh-source')
  assert.equal(info.goal, '完成 DSH 任务')
  assert.equal(info.projectDir, project)
  assert.equal(info.title, 'DSH 测试任务')
  assert.match(info.progress, /第二个压缩帧/)
})
test('async DSH list reads nested headers and deduplicates normalized session IDs', async () => {
  const rows = await listDshSessions(ctxFor({ sessionQuery: query }), new Set(['session-dsh-destination']))
  assert.equal(rows.length, 2)
  assert.equal(rows[0].projectDir, project)
  assert.equal(rows[0].sessionId, 'dsh-source')
  assert.match(rows[0].title, /任务/)
})
test('Codex parser keeps metadata beyond 16KB and excludes seeded-only texts', () => {
  assert.equal(parseRollout(sourceFile).sessionId, 'codex-source')
  assert.equal(pickTaskText(['You are Codex', '<environment_context>']), '')
  const threads = listCodexThreads(20)
  assert.equal(threads.filter((row) => row.sessionId === 'codex-source').length, 1)
  assert.equal(threads.find((row) => row.sessionId === 'codex-source').title, '完成任务 codex-source')
})
test('DSH → Codex staging is idempotent during concurrent clicks and ID prefix changes', async () => {
  fresh()
  const core = createCore(ctxFor(), {})
  const [a, b] = await Promise.all([core.convertDsh({ sessionId: 'session-dsh-source' }), core.convertDsh({ sessionId: 'dsh-source' })])
  assert.equal(a.id, b.id)
  assert.equal(store.loadAllTasks().length, 1)
  assert.equal(a.projectDir, project)
  assert.equal(a.packet.task.projectDir, project)
  assert.match(renderPrompt(a.packet), /Working directory/)
  assert.match(renderPrompt(a.packet), /第二个压缩帧/)
  assert.match(renderPrompt(a.packet), /不要修改登录接口/)
})
test('Codex → DSH staging reuses task for repeated import or another rollout of same thread', () => {
  fresh()
  const core = createCore(ctxFor(), {})
  const a = core.convertCodex({ rolloutFile: sourceFile })
  const b = core.convertCodex({ rolloutFile: sourceCopy })
  assert.equal(a.id, b.id)
  assert.equal(store.loadAllTasks().length, 1)
  assert.equal(a.packet.task.projectDir, project)
  assert.match(a.packet.task.goal, /codex-source/)
  assert.match(renderPrompt(a.packet), /保持 API 兼容/)
})
test('board groups project sessions and excludes the whole created project and linked destination', async () => {
  fresh()
  const core = createCore(ctxFor({ sessionQuery: query }), {})
  let board = await core.board()
  const cards = [...board.codexThreads, ...board.dshSessions]
  assert.equal(cards.length, 1)
  assert.equal(cards[0].sources.find((source) => source.kind === 'codex').sessionCount, 2)
  assert.equal(cards[0].sources.find((source) => source.kind === 'dsh').sessionCount, 3)
  const task = core.convertCodex({ rolloutFile: sourceFile })
  task.execution = { dshSessionId: 'session-dsh-destination' }
  store.saveTask(task)
  const duplicate = store.createTask({ ...task, id: undefined })
  duplicate.source = task.source
  store.saveTask(duplicate)
  board = await core.board()
  assert.equal(board.tasks.length, 1)
  assert.equal(board.codexThreads.length, 0)
  assert.equal(board.dshSessions.length, 0)
  assert.equal(store.loadAllTasks().length, 2, 'historical duplicates preserved on disk')
  assert.equal('settings' in board, false)
})
test('Codex → DSH execution creates once, injects exact packet and records destination', async () => {
  fresh()
  let creates = 0, prompts = 0
  const core = createCore(ctxFor({ sessionController: {
    async create(args) { creates++; assert.equal(args.cwd, project); await new Promise((r) => setTimeout(r, 10)); return { header: { id: 'session-dsh-destination' } } },
    async prompt(args, signal) { assert.equal(typeof signal.throwIfAborted, 'function'); prompts++; assert.equal(args.sessionId, 'session-dsh-destination'); assert.match(args.content[0].text, /codex-source/); assert.equal(args.mode, 'queue') },
  } }), {})
  const task = core.convertCodex({ rolloutFile: sourceFile })
  const [a, b] = await Promise.all([core.executeTask({ taskId: task.id }), core.executeTask({ taskId: task.id })])
  assert.equal(creates, 1); assert.equal(prompts, 1)
  assert.equal(a.id, b.id); assert.equal(a.status, 'executing'); assert.equal(a.owner, 'dsh')
  await assert.rejects(core.executeTask({ taskId: task.id }), /仅待执行/)
})
test('DSH prompt failure is visible and retry reuses the already-created session', async () => {
  fresh()
  let creates = 0, prompts = 0
  const core = createCore(ctxFor({ sessionQuery: {
    async readSession(id) { return { session:{ id, cwd:project }, events:[] } },
  }, sessionController: {
    async create() { creates++; return 'session-retry' },
    async prompt() { if (++prompts === 1) return { accepted: false } },
  } }), {})
  const task = core.convertCodex({ rolloutFile: sourceFile })
  await assert.rejects(core.executeTask({ taskId: task.id }), /未接受/)
  assert.equal(store.loadTask(task.id).status, 'failed')
  const retry = await core.refreshTask({ taskId:task.id })
  assert.equal(retry.packet.executionPlan.targetSession, 'session-retry')
  const retried = await core.executeTask({ taskId:task.id, expectedRevision:retry.revision, expectedDigest:retry.packet.digest })
  assert.equal(creates, 1); assert.equal(retried.status, 'executing')
})
test('DSH → Codex runs with correct cwd, stdin, sandbox and result association', async () => {
  fresh()
  const core = createCore(ctxFor(), { codexBinary: stub })
  const task = await core.convertDsh({ sessionId: 'dsh-source' })
  const running = await core.executeTask({ taskId: task.id })
  const changed = path.join(project, 'observed-change.js')
  fs.writeFileSync(changed, 'after launch')
  const runFile = rollout('codex-run')
  const unrelated = rollout('unrelated-newest')
  fs.utimesSync(unrelated, new Date(Date.now() + 2000), new Date(Date.now() + 2000))
  await waitForResult(running)
  await core.finalizeTasks()
  const settled = store.loadTask(task.id)
  assert.equal(settled.status, 'awaiting-review')
  assert.equal(settled.execution.codexSessionId, 'codex-run')
  assert.deepEqual(settled.result.observed.changedFiles, ['observed-change.js'])
  assert.equal(fs.realpathSync(fs.readFileSync(path.join(sandbox, 'cwd.txt'), 'utf8').trim()), fs.realpathSync(project))
  assert.match(fs.readFileSync(path.join(sandbox, 'prompt.txt'), 'utf8'), /完成 DSH 任务/)
  assert.match(fs.readFileSync(path.join(sandbox, 'args.txt'), 'utf8'), /--sandbox\nworkspace-write\n/)
  fs.unlinkSync(runFile); fs.unlinkSync(unrelated); fs.unlinkSync(changed)
})
test('resume options precede subcommand and still send prompt via stdin', async () => {
  fresh()
  const core = createCore(ctxFor(), { codexBinary: stub })
  const task = core.convertCodex({ rolloutFile: sourceFile })
  const running = { execution: await executeToCodex({ ...task, execution: { codexSessionId: 'codex-source' } }, { codexBinary: stub }) }
  await waitForResult(running)
  const args = fs.readFileSync(path.join(sandbox, 'args.txt'), 'utf8').trim().split('\n')
  assert.ok(args.indexOf('--sandbox') < args.indexOf('resume'))
  assert.deepEqual(args.slice(-3), ['resume', 'codex-source', '-'])
})
test('spawn errors never masquerade as executing or write a silent automation', async () => {
  fresh()
  const core = createCore(ctxFor(), { codexBinary: path.join(sandbox, 'missing-binary') })
  const task = await core.convertDsh({ sessionId: 'dsh-source' })
  await assert.rejects(core.executeTask({ taskId: task.id }), { code:'receiver-unavailable' })
  assert.equal(store.loadTask(task.id).status, 'staged', 'capability preflight rejects before starting')
  assert.equal(fs.existsSync(path.join(sandbox, '.codex', 'automations')), false)
})
test('nonzero Codex exit becomes failed rather than awaiting review', async () => {
  fresh()
  const failBin = path.join(sandbox, 'fail-codex')
  fs.writeFileSync(failBin, '#!/bin/sh\ncat > /dev/null\nexit 42\n'); fs.chmodSync(failBin, 0o755)
  const core = createCore(ctxFor(), { codexBinary: failBin })
  const task = await core.convertDsh({ sessionId: 'dsh-source' })
  const running = await core.executeTask({ taskId: task.id })
  await waitForResult(running)
  await core.finalizeTasks()
  assert.equal(store.loadTask(task.id).status, 'failed')
  assert.match(store.loadTask(task.id).error, /42/)
})
test('real HTTP convert routes preserve idempotency in both directions', async () => {
  fresh()
  let handler
  const ctx = ctxFor({ webServer: { register(route) { handler = route.handler; return () => {} } } })
  const core = createCore(ctx, {})
  registerRoutes(ctx, core)
  const server = http.createServer(handler).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const url = `http://127.0.0.1:${server.address().port}`
    const post = async (body) => {
      const res = await fetch(`${url}/api/dsh-handshake/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify(body) })
      assert.equal(res.status, 200)
      return res.json()
    }
    const [a,b] = await Promise.all([post({ kind: 'dsh', sessionId: 'dsh-source' }), post({ kind: 'dsh', sessionId: 'session-dsh-source' })])
    assert.equal(a.task.id, b.task.id)
    const c = await post({ kind: 'codex', rolloutFile: sourceFile })
    const d = await post({ kind: 'codex', rolloutFile: sourceCopy })
    assert.equal(c.task.id, d.task.id)
    const res = await fetch(`${url}/api/dsh-handshake/board`)
    assert.equal((await res.json()).tasks.length, 1)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
test('production bundle is v0.2.1 and has no quota module or stream meter', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)))
  assert.equal(pkg.version, '0.2.1')
  assert.equal(pkg.files.some((file) => /quota|usage/.test(file)), false)
  const core = fs.readFileSync(new URL('../host/core.js', import.meta.url), 'utf8')
  assert.doesNotMatch(core, /quota|pluginSettings/)
  assert.equal(fs.existsSync(new URL('../host/usage.js', import.meta.url)), false)
})

test('desktop native connection.fetch routes support conversion and reject foreign origins', async () => {
  fresh()
  const registrations = []
  const ctx = ctxFor({ connection: { fetch: { register(route) { registrations.push(route); return () => {} } } } })
  const core = createCore(ctx, {})
  registerRoutes(ctx, core)
  const route = registrations.find((route) => route.path.endsWith('/convert'))
  assert.deepEqual(route.methods, ['POST'])
  const make = (origin) => new Request('https://localhost/api/dsh-handshake/convert', {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ kind: 'codex', rolloutFile: sourceFile }),
  })
  const denied = await route.fetch(make('https://foreign.example'))
  assert.equal(denied.status, 403)
  const res = await route.fetch(make('https://localhost'))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).task.projectDir, project)
})

test('Codex navigation accepts the desktop proxy while blocking browser and remote requests', async () => {
  const registrations = []
  const opened = []
  const ctx = ctxFor({connection:{fetch:{register(route){registrations.push(route)}}}})
  registerRoutes(ctx,{openCodex(...args){opened.push(args)}})
  const route = registrations.find((entry)=>entry.path.endsWith('/open-codex'))
  const request = (base,headers) => new Request(base + route.path,{
    method:'POST', headers:{'content-type':'application/json', ...headers},
    body:JSON.stringify({taskId:'fixture',role:'source'}),
  })
  assert.equal((await route.fetch(request('http://dsh.internal',{host:'127.0.0.1:3456'}))).status,200)
  assert.equal((await route.fetch(request('dsh-app://app',{origin:'dsh-app://app'}))).status,200)
  assert.equal((await route.fetch(request('http://dsh.internal',{host:'127.0.0.1:3456',origin:'http://127.0.0.1:3456'}))).status,403)
  assert.equal((await route.fetch(request('http://dsh.internal',{host:'127.0.0.1:3456','sec-fetch-site':'same-origin'}))).status,500)
  assert.equal((await route.fetch(request('http://dsh.internal',{host:'example.com'}))).status,500)
  assert.equal((await route.fetch(request('http://127.0.0.1:3456',{host:'127.0.0.1:3456'}))).status,500)
  assert.deepEqual(opened,[['fixture','source'],['fixture','source']])
})

test('DSH query reads raw events rather than body-free listEvents summaries', async () => {
  const info = await extractDshContext(ctxFor({ sessionQuery: query }), 'dsh-source')
  assert.equal(info.goal, '完成 DSH 任务')
  assert.equal(info.projectDir, project)
  assert.match(info.progress, /第二个压缩帧/)
})

test('internal DSH subagents never become top-level pending cards', async () => {
  const rows = await listDshSessions(ctxFor({ sessionQuery: {
    async listSessions() { return [
      { header: { id: 'session-main', cwd: project, delegationDepth: 0 } },
      { header: { id: 'child-1', cwd: project, delegationDepth: 1, origin: 'subagent' } },
      { header: { id: 'child-2', cwd: project, origin: 'subagent' } },
      { header: { id: 'session-user-fork', cwd: project, delegationDepth: 0, isSeeded: true } },
    ] },
  } }))
  assert.deepEqual(rows.map((row) => row.sessionId).sort(), ['main', 'user-fork'])
})
test('attachment blocks preserve references in packets but use the actual request as title', () => {
  const text = '# Files mentioned by the user:\n## handoff.md: /project/handoff.md\n\n## My request:\n优化 Handshake 图标\n保留版本 0.1'
  assert.equal(taskTitle(text), '优化 Handshake 图标')
  assert.match(pickTaskText([text]), /handoff.md/)
  assert.equal(pickTaskText(['# Files mentioned by the user:\n## handoff.md']), '')
})

test('project grouping combines relocated directories and selects the latest main session', () => {
  const rows = groupProjects([
    { sessionId: 'old', projectDir: '/old/Agent Dashboard/', lastActivity: '2026-11-01T10:00:00Z' },
    { sessionId: 'latest', projectDir: '/new/Agent Dashboard', lastActivity: Date.parse('2026-11-08T10:00:00Z') },
    { sessionId: 'latest', projectDir: '/new/Agent Dashboard', lastActivity: '2026-11-08T10:00:00Z' },
    { sessionId: 'other', projectDir: '/new/Other', lastActivity: '2026-11-02T10:00:00Z' },
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].sessionId, 'latest')
  assert.equal(rows[0].projectDir, '/new/Agent Dashboard')
  assert.equal(rows[0].sessionCount, 2, 'duplicate session entries do not inflate the count')
  assert.equal(projectKey('/old/Agent Dashboard/'), projectKey('/new/agent dashboard'))
})
test('the displayed Codex session is used and an independent session shares the card only', async () => {
  fresh()
  fs.utimesSync(sourceFile, new Date('2026-11-01'), new Date('2026-11-01'))
  fs.utimesSync(sourceCopy, new Date('2026-11-02'), new Date('2026-11-02'))
  fs.utimesSync(otherFile, new Date('2026-11-08'), new Date('2026-11-08'))
  const core = createCore(ctxFor(), {})
  const board = await core.board()
  const candidate = [...board.codexThreads, ...board.dshSessions][0].sources.find((source) => source.kind === 'codex')
  assert.equal(candidate.sessionId, 'codex-other')
  const task = core.convertCodex({ rolloutFile: candidate.file })
  assert.equal(task.source.codexSessionId, candidate.sessionId)
  const independent = core.convertCodex({ rolloutFile: sourceFile })
  assert.notEqual(independent.id, task.id)
  assert.equal(store.loadAllTasks().length, 2)
  assert.equal((await core.board()).tasks.length, 1)
  assert.deepEqual(core.taskDetail(task.id).relatedTasks.map((row) => row.id), [independent.id])
  assert.equal(independent.packet.brief.goal.includes('codex-other'), false)
  assert.equal((await core.board()).codexThreads.length, 0)
  core.deleteTask(task.id)
  const restoredBoard = await core.board()
  const restored = [...restoredBoard.codexThreads, ...restoredBoard.dshSessions]
  assert.equal(restored.length, 1)
  assert.equal(restored[0].sources.find((source) => source.kind === 'codex').sessionCount, 2)
})
test('concurrent independent DSH sessions share one project card and retain both tasks', async () => {
  fresh()
  const core = createCore(ctxFor({ sessionQuery: {
    ...query,
    async readSession(id) { return { session: { id, cwd: project }, events } },
  } }), {})
  const [a,b] = await Promise.all([
    core.convertDsh({ sessionId: 'dsh-source' }),
    core.convertDsh({ sessionId: 'dsh-other' }),
  ])
  assert.notEqual(a.id, b.id)
  assert.equal(store.loadAllTasks().length, 2)
  assert.equal((await core.board()).tasks.length, 1)
  assert.equal((await core.board()).dshSessions.length, 0)
  assert.equal((await core.board()).codexThreads.length, 0, 'one project card owns both directions')
})
test('historical relay duplicates of a project fold in the view without deleting records', async () => {
  fresh()
  const core = createCore(ctxFor(), {})
  const original = core.convertCodex({ rolloutFile: sourceFile })
  const duplicate = store.createTask({ title: 'older thread of the same project', projectDir: project,
    source: { kind: 'codex', codexSessionId: 'different-source' }, packet: original.packet })
  duplicate.status = 'executing'
  store.saveTask(duplicate)
  const board = await core.board()
  assert.equal(board.tasks.length, 1)
  assert.equal(board.tasks[0].id, duplicate.id, 'running relay takes precedence')
  assert.equal(store.loadAllTasks().length, 2)
})
