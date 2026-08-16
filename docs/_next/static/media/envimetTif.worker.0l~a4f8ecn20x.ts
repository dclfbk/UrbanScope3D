/**
 * Web Worker di decodifica dei GeoTIFF ENVI-met: fetch (con progress sui byte
 * reali — Pages non ricomprime i tif LZW, quindi Content-Length e' esatto) +
 * decodifica in cubo Float32 (lib/envimetDecode.ts), tutto FUORI dal main
 * thread. I buffer tornano al chiamante come transferable (zero copie).
 *
 * Protocollo messaggi (vedi lib/envimetTif.ts):
 *   in : { type: 'load', key, url }
 *   out: { type: 'progress', key, loaded, total }
 *      | { type: 'done', key, w, h, nz, zM, data, min, max, p2, p98 }
 *      | { type: 'error', key, message }
 */
import { decodeEnvimetTif } from '@/lib/envimetDecode'

type LoadMsg = { type: 'load'; key: string; url: string }

/** Fetch in streaming che riporta l'avanzamento del download via postMessage. */
async function fetchWithProgress(key: string, url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`)
  if (!res.body) return res.arrayBuffer()
  const total = parseInt(res.headers.get('content-length') ?? '0', 10)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (total > 0) self.postMessage({ type: 'progress', key, loaded, total })
  }
  const all = new Uint8Array(loaded)
  let off = 0
  for (const c of chunks) {
    all.set(c, off)
    off += c.length
  }
  return all.buffer
}

self.onmessage = async (e: MessageEvent<LoadMsg>) => {
  const { type, key, url } = e.data
  if (type !== 'load') return
  try {
    const buffer = await fetchWithProgress(key, url)
    const cube = await decodeEnvimetTif(buffer)
    self.postMessage(
      {
        type: 'done',
        key,
        w: cube.w,
        h: cube.h,
        nz: cube.nz,
        zM: cube.zM,
        data: cube.data,
        min: cube.min,
        max: cube.max,
        p2: cube.p2,
        p98: cube.p98,
      },
      // transferable: il cubo (~15 MB) passa al main thread senza copia
      { transfer: [cube.data.buffer, cube.zM.buffer] },
    )
  } catch (err) {
    self.postMessage({
      type: 'error',
      key,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
