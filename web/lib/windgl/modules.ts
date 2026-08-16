/*
 * Shader module luma.gl per il motore particelle, derivati da WeatherLayers GL
 * (https://github.com/weatherlayers/weatherlayers-gl), MPL-2.0
 * (http://mozilla.org/MPL/2.0/). Copyright (c) WeatherLayers.com.
 * Semplificati per UrbanScope3D: solo Web Mercator, niente globe, niente
 * minificazione GLSL (i nomi degli uniform sono quelli veri).
 */
import type { ShaderModule } from '@luma.gl/shadertools'
import type { Texture } from '@luma.gl/core'
import {
  BITMAP_MODULE_GLSL,
  RASTER_MODULE_GLSL,
  PALETTE_MODULE_GLSL,
  PARTICLE_MODULE_GLSL,
} from './shaders'

/** Interpolazione della texture u/v (indici della LUT in pixel.glsl). */
export const ImageInterpolation = {
  NEAREST: 'NEAREST',
  LINEAR: 'LINEAR',
  CUBIC: 'CUBIC',
} as const
export type ImageInterpolation =
  (typeof ImageInterpolation)[keyof typeof ImageInterpolation]

export type Bounds4 = [number, number, number, number]

export type BitmapModuleProps = {
  bounds?: Bounds4
}

/* eslint-disable @typescript-eslint/no-explicit-any -- gli uniform dei moduli
   luma.gl sono volutamente non tipizzati (stesso pattern di WeatherLayers). */
type BitmapModuleUniforms = {
  bounds: any
  isRepeatBounds: any
  coordinateConversion: any
  transparentColor: any
}

export const bitmapModule = {
  name: 'bitmap2',
  vs: BITMAP_MODULE_GLSL,
  fs: BITMAP_MODULE_GLSL,
  uniformTypes: {
    bounds: 'vec4<f32>',
    isRepeatBounds: 'f32',
    coordinateConversion: 'f32',
    transparentColor: 'vec4<f32>',
  },
  getUniforms: (props: Partial<BitmapModuleProps> = {}) => ({
    bounds: props.bounds ?? [0, 0, 0, 0],
    isRepeatBounds: 0,
    coordinateConversion: 0,
    transparentColor: [0, 0, 0, 0],
  }),
} as const satisfies ShaderModule<BitmapModuleProps, BitmapModuleUniforms>

export type RasterModuleProps = {
  imageTexture: Texture
  imageTexture2: Texture
  imageSmoothing?: number
  imageInterpolation?: ImageInterpolation
  imageUnscale?: [number, number] | null
}

type RasterModuleUniforms = {
  imageResolution: any
  imageSmoothing: any
  imageInterpolation: any
  imageWeight: any
  imageType: any
  imageUnscale: any
  imageMinValue: any
  imageMaxValue: any
}

export const rasterModule = {
  name: 'raster',
  vs: RASTER_MODULE_GLSL,
  fs: RASTER_MODULE_GLSL,
  uniformTypes: {
    imageResolution: 'vec2<f32>',
    imageSmoothing: 'f32',
    imageInterpolation: 'f32',
    imageWeight: 'f32',
    imageType: 'f32',
    imageUnscale: 'vec2<f32>',
    imageMinValue: 'f32',
    imageMaxValue: 'f32',
  },
  getUniforms: (props: Partial<RasterModuleProps> = {}) => ({
    imageTexture: props.imageTexture,
    imageTexture2: props.imageTexture2 ?? props.imageTexture,
    imageResolution: props.imageTexture
      ? [props.imageTexture.width, props.imageTexture.height]
      : [0, 0],
    imageSmoothing: props.imageSmoothing ?? 0,
    imageInterpolation: Object.values(ImageInterpolation).indexOf(
      props.imageInterpolation ?? ImageInterpolation.CUBIC,
    ),
    imageWeight: 0,
    imageType: 1, // sempre VECTOR (u/v)
    imageUnscale: props.imageUnscale ?? [0, 0],
    imageMinValue: Number.NaN, // NaN = nessun filtro min/max (vedi isNaN nello shader)
    imageMaxValue: Number.NaN,
  }),
} as const satisfies ShaderModule<RasterModuleProps, RasterModuleUniforms>

export type PaletteModuleProps = {
  paletteTexture?: Texture
  paletteBounds?: readonly [number, number]
  paletteColor?: [number, number, number, number]
}

type PaletteModuleUniforms = {
  paletteBounds: any
  paletteColor: any
}

export const paletteModule = {
  name: 'palette',
  vs: PALETTE_MODULE_GLSL,
  fs: PALETTE_MODULE_GLSL,
  uniformTypes: {
    paletteBounds: 'vec2<f32>',
    paletteColor: 'vec4<f32>',
  },
  getUniforms: (props: Partial<PaletteModuleProps> = {}) => ({
    paletteTexture: props.paletteTexture,
    paletteBounds: props.paletteBounds ?? [0, 0],
    paletteColor: props.paletteColor ?? [1, 1, 1, 1],
  }),
} as const satisfies ShaderModule<PaletteModuleProps, PaletteModuleUniforms>

export type ParticleModuleProps = {
  viewportBounds?: Bounds4
  /** [a, b, c, zRel]: quota = a + b*lon + c*lat + zRel (patch 3D). */
  groundPlane?: [number, number, number, number]
  viewportZoomChangeFactor?: number
  numParticles: number
  maxAge: number
  speedFactor: number
  time: number
  seed: number
}

type ParticleModuleUniforms = {
  viewportBounds: any
  groundPlane: any
  viewportZoomChangeFactor: any
  numParticles: any
  maxAge: any
  speedFactor: any
  time: any
  seed: any
}

export const particleModule = {
  name: 'particle',
  vs: PARTICLE_MODULE_GLSL,
  fs: PARTICLE_MODULE_GLSL,
  uniformTypes: {
    viewportBounds: 'vec4<f32>',
    groundPlane: 'vec4<f32>',
    viewportZoomChangeFactor: 'f32',
    numParticles: 'f32',
    maxAge: 'f32',
    speedFactor: 'f32',
    time: 'f32',
    seed: 'f32',
  },
  getUniforms: (props: Partial<ParticleModuleProps> = {}) => ({
    viewportBounds: props.viewportBounds ?? [0, 0, 0, 0],
    groundPlane: props.groundPlane ?? [0, 0, 0, 0],
    viewportZoomChangeFactor: props.viewportZoomChangeFactor ?? 0,
    numParticles: props.numParticles,
    maxAge: props.maxAge,
    speedFactor: props.speedFactor,
    time: props.time,
    seed: props.seed,
  }),
} as const satisfies ShaderModule<ParticleModuleProps, ParticleModuleUniforms>
