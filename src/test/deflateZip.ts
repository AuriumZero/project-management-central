// Writes a zip with deflated entries, as Excel does, to test the reader.
// The CRC is left at zero because the reader doesn't check it.
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close() } })
  const output = input.pipeThrough(new CompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(output).arrayBuffer())
}

export async function deflateZip(files: [string, string][]): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of files) {
    const nameBytes = enc.encode(name)
    const raw = enc.encode(content)
    const data = await deflate(raw)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(8, 8, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, raw.length, true)
    local.setUint16(26, nameBytes.length, true)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(10, 8, true)
    dir.setUint32(20, data.length, true)
    dir.setUint32(24, raw.length, true)
    dir.setUint16(28, nameBytes.length, true)
    dir.setUint32(42, offset, true)
    parts.push(new Uint8Array(local.buffer), nameBytes, data)
    central.push(new Uint8Array(dir.buffer), nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const dirSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, dirSize, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out
}
