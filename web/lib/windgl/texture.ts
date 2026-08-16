/*
 * Texture helper per il motore particelle, derivati da WeatherLayers GL
 * (https://github.com/weatherlayers/weatherlayers-gl), MPL-2.0
 * (http://mozilla.org/MPL/2.0/). Copyright (c) WeatherLayers.com.
 * La palette qui e' una rampa a stop espliciti (niente dipendenza cpt2js).
 */
import type { Device, Texture, TextureFormat } from '@luma.gl/core'

/** Dati raster grezzi da caricare come texture (RGBA Uint8 o Float32 r/rg). */
export type TextureData = {
  data: Uint8Array | Uint8ClampedArray | Float32Array
  width: number
  height: number
}

function getTextureFormat(image: TextureData): TextureFormat {
  const { data, width, height } = image
  const bandsCount = data.length / (width * height)
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    if (bandsCount === 4) return 'rgba8unorm'
    if (bandsCount === 2) return 'rg8unorm'
    if (bandsCount === 1) return 'r8unorm'
    throw new Error('Formato dati non supportato')
  }
  if (data instanceof Float32Array) {
    if (bandsCount === 2) return 'rg32float'
    if (bandsCount === 1) return 'r32float'
    throw new Error('Formato dati non supportato')
  }
  throw new Error('Formato dati non supportato')
}

const textureCache = new WeakMap<Device, WeakMap<TextureData, Texture>>()

/** Crea (o riusa) la texture della TextureData: sampler NEAREST, l'interpolazione la fa pixel.glsl. */
export function createTextureCached(device: Device, image: TextureData): Texture {
  let byImage = textureCache.get(device)
  if (!byImage) {
    byImage = new WeakMap()
    textureCache.set(device, byImage)
  }
  let texture = byImage.get(image)
  if (!texture) {
    texture = device.createTexture({
      format: getTextureFormat(image),
      width: image.width,
      height: image.height,
      mipLevels: 1,
      sampler: {
        magFilter: 'nearest',
        minFilter: 'nearest',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        lodMaxClamp: 0,
      },
    })
    texture.copyImageData({ data: image.data })
    byImage.set(image, texture)
  }
  return texture
}

const emptyTextureCache = new WeakMap<Device, Texture>()

export function createEmptyTextureCached(device: Device): Texture {
  let texture = emptyTextureCache.get(device)
  if (!texture) {
    texture = device.createTexture({ width: 1, height: 1, mipLevels: 1 })
    texture.copyImageData({ data: new Uint8Array([0, 0, 0, 0]) })
    emptyTextureCache.set(device, texture)
  }
  return texture
}

/** Stop di palette: [valore, [r, g, b, a? in 0-255]]. */
export type PaletteStop = [number, [number, number, number, number?]]

/**
 * Rampa colore -> texture 256x1 (equivalente locale di cpt2js/colorRampCanvas):
 * interpolazione lineare fra gli stop, dominio = [primo valore, ultimo valore].
 */
export function createPaletteTexture(
  device: Device,
  stops: PaletteStop[],
): { paletteBounds: [number, number]; paletteTexture: Texture } {
  const n = 256
  const min = stops[0][0]
  const max = stops[stops.length - 1][0]
  const span = Math.max(1e-9, max - min)
  const data = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const v = min + (i / (n - 1)) * span
    let j = 0
    while (j < stops.length - 2 && stops[j + 1][0] < v) j++
    const [v0, c0] = stops[j]
    const [v1, c1] = stops[j + 1]
    const f = Math.max(0, Math.min(1, (v - v0) / Math.max(1e-9, v1 - v0)))
    data[i * 4] = Math.round(c0[0] + (c1[0] - c0[0]) * f)
    data[i * 4 + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * f)
    data[i * 4 + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * f)
    const a0 = c0[3] ?? 255
    const a1 = c1[3] ?? 255
    data[i * 4 + 3] = Math.round(a0 + (a1 - a0) * f)
  }
  const paletteTexture = device.createTexture({
    format: 'rgba8unorm',
    width: n,
    height: 1,
    mipLevels: 1,
    sampler: {
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    },
  })
  paletteTexture.copyImageData({ data })
  return { paletteBounds: [min, max], paletteTexture }
}
