/**
 * Agent-facing entries, one operation two callers (user-actions.md):
 *   - the `/handshake` session command (user-initiated, may execute),
 *   - the `handshake` agent tool (staging and status only — executing a
 *     hand-off is an authority-granting action and stays user-only).
 */
import { loadAllTasks, taskSummary } from './store.js'

function agentSessionId(agent) {
  return (
    agent?.sessionId ??
    agent?.session?.id ??
    agent?.session?.sessionId ??
    (typeof agent?.id === 'string' && agent.id.startsWith('session') ? agent.id : undefined)
  )
}

function formatBoardLines(core) {
  const tasks = loadAllTasks()
  if (tasks.length === 0) return ['还没有接力任务。用 /handshake convert 转换当前会话。']
  return tasks.map((task) => {
    const summary = taskSummary(task)
    return `- [${summary.id}] ${summary.title} · ${summary.status} · 棒位 ${summary.owner} · ${summary.projectDir || '(无目录)'}`
  })
}

export function registerAgent(ctx, core, config) {
  const offs = []

  const tools = ctx.get?.('tools')
  if (tools && typeof tools.register === 'function') {
    const dispose = tools.register({
      name: 'handshake',
      description:
        'DSH-Handshake 任务接力：把当前或指定任务转换为 DSH↔Codex 交接包、导入 Codex 任务、查看接力看板。' +
        ' 执行（execute）是用户专属动作，请提示用户在接力看板点击「确认执行」。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['convert', 'import-codex', 'list', 'status', 'board', 'acknowledge'],
            description: 'convert: 把会话转换成交接包（仅暂存）；import-codex: 导入 Codex rollout 文件；list/status/board: 查询。',
          },
          sessionId: { type: 'string', description: 'action=convert 时的 DSH 会话 ID（默认当前会话）' },
          rolloutFile: { type: 'string', description: 'action=import-codex 时的 rollout 文件路径' },
          taskId: { type: 'string', description: '任务 ID' },
          revision: { type: 'number', description: 'acknowledge 必须提供接收的交接轮次' },
          packetDigest: { type: 'string', description: 'acknowledge 必须提供该轮交接包摘要' },
        },
        required: ['action'],
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        const action = args?.action
        try {
          if (action === 'convert') {
            const sessionId = args?.sessionId
              ?? agentSessionId(exec?.agent)
              ?? agentSessionId(exec)
              ?? agentSessionId(this?.agent)
            const task = await core.convertDsh({ sessionId })
            return { ok: true, taskId: task.id, status: task.status, hint: '已转换并暂存。请在接力看板点击「确认执行」完成交接。' }
          }
          if (action === 'import-codex') {
            const task = core.convertCodex({ rolloutFile: args?.rolloutFile })
            return { ok: true, taskId: task.id, status: task.status, hint: '已导入并暂存。请在接力看板点击「确认执行」完成交接。' }
          }
          if (action === 'acknowledge') return { ok: true, reception: core.acknowledge(args) }
          if (action === 'status') {
            return core.taskDetail(args?.taskId ?? '')
          }
          if (action === 'board') {
            return await core.board()
          }
          /* list + default */
          return { ok: true, tasks: loadAllTasks().map(taskSummary) }
        } catch (error) {
          return { ok: false, error: String(error?.message ?? error) }
        }
      },
    })
    offs.push(typeof dispose === 'function' ? dispose : () => {})
  }

  const commands = ctx.get?.('commands')
  if (commands && typeof commands.register === 'function') {
    const dispose = commands.register({
      name: 'handshake',
      description: 'DSH-Handshake 任务接力：convert / import <rollout> / execute <id> / list / status <id>',
      input: { hint: 'convert | import <rollout 文件> | execute <任务ID> | list | status <任务ID>' },
      async handler(invocation) {
        const line = String(invocation?.rawInput ?? '').trim()
        const parts = line.replace(/^\/?handshake\b/, '').trim().split(/\s+/).filter((p) => p !== '')
        const sub = parts[0] ?? 'list'
        try {
          if (sub === 'convert') {
            const sessionId = agentSessionId(invocation?.agent)
            const task = await core.convertDsh({ sessionId })
            return { kind: 'success', text: `已转换并暂存：${task.id}（${task.title}）。在接力看板点「确认执行」完成交接，或运行 /handshake execute ${task.id}` }
          }
          if (sub === 'import') {
            const task = core.convertCodex({ rolloutFile: parts[1] ?? '' })
            return { kind: 'success', text: `已导入 Codex 任务并暂存：${task.id}。运行 /handshake execute ${task.id} 转到 DSH 续做。` }
          }
          if (sub === 'execute') {
            const task = await core.executeTask({ taskId: parts[1] ?? '' })
            return { kind: 'success', text: `已启动执行（${task.execution?.transport ?? '?'}）。任务 ${task.id} 当前状态：${task.status}` }
          }
          if (sub === 'status') {
            const detail = core.taskDetail(parts[1] ?? '')
            return { kind: 'success', text: JSON.stringify({ task: detail.task }, null, 2) }
          }
          return { kind: 'success', text: formatBoardLines(core).join('\n') }
        } catch (error) {
          return { kind: 'error', text: String(error?.message ?? error) }
        }
      },
    })
    offs.push(typeof dispose === 'function' ? dispose : () => {})
  }

  return () => {
    for (const off of offs) {
      try {
        off()
      } catch {
        /* dispose defensively */
      }
    }
  }
}
