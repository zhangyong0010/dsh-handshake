/**
 * Shared HTTP helpers for the DSH-Handshake host routes: JSON responses,
 * a size-capped JSON body reader, and the same-origin / host request gate.
 */
import os from 'node:os'

/** Write a JSON payload with no-store caching. */
export function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** Read a JSON request body, capped at `limit` bytes. Returns {} on empty. */
export function readJsonBody(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

/** Whether a remote address is loopback. */
export function isLoopback(request) {
  const addr = request.socket?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr === ''
}

/**
 * Same-origin discipline for mutating routes: a browser request must present
 * an Origin whose host matches the Host header; a non-browser caller (curl,
 * local scripts) is accepted only from loopback.
 */
export function sameOriginOk(request) {
  const origin = request.headers?.origin
  if (origin === undefined || origin === '') return isLoopback(request)
  try {
    const originHost = new URL(origin).host
    return originHost === (request.headers?.host ?? '')
  } catch {
    return false
  }
}

/**
 * The host's own request gate when it publishes one (browser login + Host/Origin
 * fence). Mirrors the dshmarket posture: ask the connection service the host
 * already runs; a host without the service leaves the route as-is.
 */
export function refusedByHostGate(ctx, request, response) {
  let gate
  try {
    const connection = ctx.get?.('connection')
    gate = typeof connection?.requestRejection === 'function'
      ? (req) => connection.requestRejection(req)
      : undefined
  } catch {
    gate = undefined
  }
  if (gate === undefined) return false
  let status
  try {
    status = gate(request)
  } catch {
    status = 403
  }
  if (status === undefined) return false
  sendJson(response, status, {
    error: status === 401
      ? 'DSH login required / 需要先登录 DSH'
      : 'Request refused: untrusted origin / 请求来自不受信任的地址',
  })
  return true
}

/** Home directory helper tolerant of unusual environments. */
export function homeDir() {
  if (process.env.DSH_HANDSHAKE_TEST_HOME) return process.env.DSH_HANDSHAKE_TEST_HOME
  try {
    return os.homedir()
  } catch {
    return process.env.HOME ?? process.env.USERPROFILE ?? '/tmp'
  }
}
