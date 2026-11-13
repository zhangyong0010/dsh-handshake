/** Shared operations, desktop native transport first; authenticated Web compatibility. */
import { sendJson, readJsonBody, sameOriginOk, refusedByHostGate } from './util.js'
const PREFIX = '/api/dsh-handshake'
const ROUTES = [
  ['board','GET'], ['task','GET'], ['convert','POST'], ['execute','POST'], ['update','POST'], ['delete','POST'],
  ['refresh','POST'], ['check','POST'], ['prepare','POST'], ['project','POST'], ['clarify','POST'],
  ['open-codex','POST'], ['open-dsh','POST'], ['review','POST'], ['cloud-plan','POST'], ['release-unconfirmed','POST'],
  ['replace-target','POST'], ['archive','POST'], ['hide-project','POST'],
]
const errorPayload = (error) => ({ ok:false, error:String(error.message), code:error.code, client:error.client, stopToken:error.stopToken })
function isDesktopRequest(request, url) {
  if (url.protocol === 'dsh-app:') return url.host === 'app'
  // DSH Desktop forwards authenticated requests over loopback and strips browser origin headers.
  if (url.origin !== 'http://dsh.internal' || request.headers.has('origin') || request.headers.has('sec-fetch-site')) return false
  const host = request.headers.get('host') ?? ''
  return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)
}
async function dispatch(core, name, body, url, desktop = false) {
  if (name === 'board') return core.board({ refresh: url.searchParams.get('refresh') === '1' })
  if (name === 'task') return core.taskDetail(url.searchParams.get('id') ?? '')
  if (name === 'convert') {
    if (!['codex','dsh'].includes(body.kind)) throw new Error('unknown source kind')
    const { sessionId, rolloutFile, taskId, force } = body
    const task = body.kind === 'codex' ? core.convertCodex({ rolloutFile, taskId, force }) : await core.convertDsh({ sessionId, taskId, force })
    return core.taskDetail(task.id)
  }
  if (name === 'execute') {
    if (!Number.isSafeInteger(body.expectedRevision) || typeof body.expectedDigest !== 'string') throw new Error('请刷新接力卡片并核对本轮资料后确认')
    return { ok: true, task: await core.executeTask(body) }
  }
  if (name === 'refresh') return core.taskDetail((await core.refreshTask({ taskId: body.taskId })).id)
  if (name === 'check') return core.taskDetail((await core.checkTask(body)).id)
  if (name === 'prepare') return core.taskDetail((await core.prepareNext(body)).id)
  if (name === 'clarify') return core.taskDetail((await core.clarify(body)).id)
  if (name === 'replace-target') return core.taskDetail((await core.replaceMissingTarget(body)).id)
  if (name === 'review') { await core.reviewTask(body); return core.taskDetail(body.taskId) }
  if (name === 'cloud-plan') return { ok:true, plan:core.cloudPlan(body.taskId) }
  if (name === 'open-codex') {
    if (!desktop) throw new Error('请从 DSH 桌面客户端打开 Codex')
    await core.openCodex(body.taskId, body.role)
    return { ok: true }
  }
  if (name === 'open-dsh') return { ok:true, sessionId:await core.openDsh(body.taskId,body.role) }
  if (name === 'project') return { ok: true, project: core.updateProject(body) }
  if (name === 'archive') return { ok: true, task: core.archiveTask(body) }
  if (name === 'hide-project') return { ok: true, project: core.hideProject(body) }
  if (name === 'update') return { ok: true, task: core.updateTask(body) }
  if (name === 'release-unconfirmed') return { ok: true, task: await core.releaseUnconfirmed(body) }
  if (name === 'delete') return { ok: core.deleteTask(body.taskId) }
  throw new Error('not found')
}
function registerWeb(ctx, core) {
  const server = ctx.get?.('webServer')
  if (!server?.register) return () => {}
  return server.register({ kind: 'prefix', path: PREFIX, async handler(request,response) {
    try {
      if (refusedByHostGate(ctx,request,response)) return
      const url = new URL(request.url ?? '/', 'http://localhost')
      const name = url.pathname.slice(PREFIX.length + 1)
      if (!ROUTES.some(([path,method]) => path === name && method === request.method)) return sendJson(response,404,{ok:false,error:'not found'})
      if (request.method !== 'GET' && !sameOriginOk(request)) return sendJson(response,403,{ok:false,error:'cross-origin request refused'})
      sendJson(response,200,await dispatch(core,name,request.method === 'GET' ? {} : await readJsonBody(request),url))
    } catch (error) { sendJson(response,500,errorPayload(error)) }
  } })
}
export function registerRoutes(ctx,core) {
  const register = (scope) => {
    const connection = scope.get?.('connection') ?? scope.connection
    if (!connection?.fetch?.register) return registerWeb(scope,core)
    const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
    const offs = ROUTES.map(([name,method]) => connection.fetch.register({path:`${PREFIX}/${name}`,methods:[method],requestBody:'buffered',async fetch(request) {
      try {
        const url = new URL(request.url), origin = request.headers.get('origin')
        if (origin && origin !== url.origin && !(origin === 'dsh-app://app' && url.protocol === 'dsh-app:')) return json({ok:false,error:'cross-origin request refused'},403)
        return json(await dispatch(core,name,method === 'GET' ? {} : await request.json(),url,isDesktopRequest(request,url)))
      } catch (error) { return json(errorPayload(error),500) }
    }}))
    return () => offs.forEach((off) => { if (typeof off === 'function') off() })
  }
  if (ctx.inject) {
    const off = ctx.inject(['connection'],(scope) => scope.effect(() => register(scope),'dsh-handshake: native routes'))
    return typeof off === 'function' ? off : () => {}
  }
  return register(ctx)
}
