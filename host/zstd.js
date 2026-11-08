import zlib from 'node:zlib'

/** DSH appends independent zstd frames. Node decompresses ONE frame per call. */
export function decompressFrames(raw) {
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
