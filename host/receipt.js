/** A verifiable read receipt, not a claim that an LLM semantically understood the task. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { workspaceSnapshot, hashFile, digest } from './workspace.js'

export function validateReferences(packet) {
  if (['dsh-handshake/packet@2', 'dsh-handshake/packet@3'].includes(packet?.schema)) {
    const { digest: expected, ...content } = packet
    if (digest(content) !== expected) throw new Error('交接清单摘要不一致，请重新准备交接包')
  }
  for (const reference of packet.references ?? []) {
    if (!reference.required) continue
    if (hashFile(reference.path) !== reference.sha256) throw new Error(`交接资料已变化：${reference.path}`)
  }
}
export function writeReceipt(packetFile) {
  const packet = JSON.parse(fs.readFileSync(packetFile, 'utf8'))
  validateReferences(packet)
  const snapshot = workspaceSnapshot(packet.task.projectDir,{includeDiff:false})
  if (snapshot.digest !== packet.workspace.digest) throw new Error('代码状态已变化，需重新生成本轮交接包')
  // Read complete required documents, not just their names or summary previews.
  const read = (packet.references ?? []).filter((reference) => reference.required).map((reference) => {
    if (digest(fs.readFileSync(reference.path)) !== reference.sha256) throw new Error(`读取期间资料变化：${reference.path}`)
    return { path: reference.path, sha256: reference.sha256 }
  })
  const receipt = { schema: 'dsh-handshake/receipt@1', projectId: packet.projectId, revision: packet.revision,
    packetDigest: packet.digest, workspaceDigest: snapshot.digest, read, at: new Date().toISOString() }
  fs.writeFileSync(packet.receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 })
  return receipt
}
export function readReceipt(packet) {
  if (!packet?.receiptPath) return { status: 'legacy', note: '旧版交接包尚无读取回执' }
  let receipt
  try { receipt = JSON.parse(fs.readFileSync(packet.receiptPath, 'utf8')) } catch { return { status: 'pending', note: '等待目标方核对完整交接资料' } }
  const refs = new Map(Array.isArray(receipt?.read) ? receipt.read.filter((item) => item?.path).map((item) => [item.path, item.sha256]) : [])
  const valid = receipt && Array.isArray(receipt.read) && Array.isArray(packet.references) && packet.workspace?.digest &&
    receipt.projectId === packet.projectId && receipt.revision === packet.revision && receipt.packetDigest === packet.digest &&
    receipt.workspaceDigest === packet.workspace.digest && packet.references.every((ref) => !ref.required || refs.get(ref.path) === ref.sha256)
  return { status: valid ? 'verified' : 'invalid', at: receipt?.at, note: valid ? '必读资料及代码基线已核对（不代表语义理解或验收通过）' : '回执版本或资料摘要不一致' }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(writeReceipt(process.argv[2])) + '\n') }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
