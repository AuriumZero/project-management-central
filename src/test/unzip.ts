// Reads the stored (uncompressed) entries of a zip written by `zip()` in src/lib/xlsx.ts.
export function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dec = new TextDecoder()
  const files = new Map<string, string>()
  let at = 0
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true)
    const nameLen = view.getUint16(at + 26, true)
    const name = dec.decode(bytes.subarray(at + 30, at + 30 + nameLen))
    files.set(name, dec.decode(bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size)))
    at += 30 + nameLen + size
  }
  return files
}
