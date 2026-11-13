import zlib from 'node:zlib'

/** DSH appends independent zstd frames. Node decompresses ONE frame per call. */
export function decompressFrames(raw) {
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('当前运行时不支持 zstd，需使用 DSH 会话服务读取日志')
  const chunks = []
  let offset = 0
  while (offset < raw.length) {
    const { buffer, engine } = zlib.zstdDecompressSync(raw.subarray(offset), { info: true })
    const consumed = engine.bytesWritten
    if (!consumed) throw new Error('Invalid zstd frame')
    chunks.push(buffer)
    offset += consumed
  }
  return Buffer.concat(chunks).toString('utf8')
}
