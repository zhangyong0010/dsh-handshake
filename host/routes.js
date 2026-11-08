/** Shared operations, desktop native transport first; authenticated Web compatibility. */
import { sendJson, readJsonBody, sameOriginOk, refusedByHostGate } from './util.js'
const PREFIX = '/api/dsh-handshake'
const ROUTES = [['board','GET'],['task','GET'],['convert','POST'],['execute','POST'],['update','POST'],['delete','POST'],['refresh','POST'],['prepare','POST'],['project','POST']]
async function dispatch(core, name, body, url) {
  if (name === 'board') return core.board()
  if (name === 'task') return core.taskDetail(url.searchParams.get('id') ?? '')
  if (name === 'convert') {
    if (!['codex','dsh'].includes(body.kind)) throw new Error('unknown source kind')
    return { ok: true, task: body.kind === 'codex' ? core.convertCodex(body) : await core.convertDsh(body) }
  }
  if (name === 'execute') return { ok: true, task: await core.executeTask(body) }
  if (name === 'refresh') return { ok: true, task: await core.refreshTask(body) }
  if (name === 'prepare') return { ok: true, task: await core.prepareNext(body) }
  if (name === 'project') return { ok: true, project: core.updateProject(body) }
  if (name === 'update') return { ok: true, task: core.updateTask(body) }
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
    } catch (error) { sendJson(response,500,{ok:false,error:String(error.message)}) }
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
        return json(await dispatch(core,name,method === 'GET' ? {} : await request.json(),url))
      } catch (error) { return json({ok:false,error:String(error.message)},500) }
    }}))
    return () => offs.forEach((off) => { if (typeof off === 'function') off() })
  }
  if (ctx.inject) {
    const off = ctx.inject(['connection'],(scope) => scope.effect(() => register(scope),'dsh-handshake: native routes'))
    return typeof off === 'function' ? off : () => {}
  }
  return register(ctx)
}
