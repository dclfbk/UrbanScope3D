/*
 * ParticleLineLayer — scie di vento GPU (transform feedback), derivato da
 * WeatherLayers GL (https://github.com/weatherlayers/weatherlayers-gl),
 * MPL-2.0 (http://mozilla.org/MPL/2.0/). Copyright (c) WeatherLayers.com.
 *
 * Modifiche UrbanScope3D:
 *  - particelle in 3D sul piano del suolo ENVI-met (props groundPlane +
 *    altitude), cosi' terreno ed edifici della scena le occludono;
 *  - il respawn casuale avviene nell'INTERSEZIONE viewport ∩ dominio dati
 *    (upstream: tutto il viewport -> con un dominio di quartiere quasi tutte
 *    le particelle nascerebbero fuori e resterebbero invisibili);
 *  - solo Web Mercator (niente globe), maxZoom di default illimitato perche'
 *    la scena vive a zoom citta' (15-18), palette a stop espliciti.
 */
import type {
  Color,
  LayerProps,
  DefaultProps,
  UpdateParameters,
  LayerContext,
  WebMercatorViewport,
} from '@deck.gl/core'
import { LineLayer } from '@deck.gl/layers'
import type { LineLayerProps } from '@deck.gl/layers'
import type { Buffer, Texture } from '@luma.gl/core'
import { BufferTransform } from '@luma.gl/engine'
import {
  bitmapModule,
  rasterModule,
  paletteModule,
  particleModule,
  ImageInterpolation,
} from './modules'
import type {
  Bounds4,
  BitmapModuleProps,
  RasterModuleProps,
  PaletteModuleProps,
  ParticleModuleProps,
} from './modules'
import { createEmptyTextureCached, createPaletteTexture } from './texture'
import type { PaletteStop } from './texture'
import { UPDATE_VS } from './shaders'

const FPS = 30
const SOURCE_POSITION = 'sourcePosition'
const TARGET_POSITION = 'targetPosition'
const SOURCE_COLOR = 'sourceColor'
const TARGET_COLOR = 'targetColor'

type _WindParticleLineLayerProps = LineLayerProps<unknown> & {
  imageTexture: Texture | null
  imageSmoothing: number
  imageInterpolation: ImageInterpolation
  /** [min, max] per riportare i canali Uint8 a m/s (u = R, v = G). */
  imageUnscale: [number, number] | null
  bounds: Bounds4
  minZoom: number | null
  maxZoom: number | null

  /** Rampa velocita' (m/s) -> colore; null = colore fisso `color`. */
  palette: PaletteStop[] | null
  color: Color | null

  numParticles: number
  maxAge: number
  speedFactor: number

  width: number
  animate: boolean

  /** Piano del suolo [a, b, c]: quota slm = a + b*lon + c*lat. */
  groundPlane: [number, number, number] | null
  /** Quota (m) delle scie sopra il piano del suolo. */
  altitude: number
}

export type WindParticleLineLayerProps = _WindParticleLineLayerProps & LayerProps

const defaultProps: DefaultProps<WindParticleLineLayerProps> = {
  imageTexture: { type: 'object', value: null },
  imageSmoothing: { type: 'number', value: 0 },
  imageInterpolation: { type: 'object', value: ImageInterpolation.CUBIC },
  imageUnscale: { type: 'array', value: null },
  bounds: { type: 'array', value: [-180, -90, 180, 90], compare: true },
  minZoom: { type: 'object', value: null },
  maxZoom: { type: 'object', value: null },

  palette: { type: 'object', value: null },
  color: { type: 'color', value: [255, 255, 255] },

  numParticles: { type: 'number', min: 1, max: 1000000, value: 5000 },
  maxAge: { type: 'number', min: 1, max: 255, value: 10 },
  speedFactor: { type: 'number', min: 0, max: 50, value: 1 },

  width: { type: 'number', value: 1 },
  animate: true,

  groundPlane: { type: 'array', value: null, compare: true },
  altitude: { type: 'number', value: 1.5 },

  wrapLongitude: true,
}

// Upstream preferisce i default alle prop passate come undefined
// (workaround per deck.gl, vedi WeatherLayers props.ts).
function ensureDefaultProps<PropsT extends {}>(
  props: PropsT,
  defaults: DefaultProps<PropsT>,
): PropsT {
  const filled = {} as PropsT
  for (const key in props) {
    if (props[key] === undefined && key in defaults) {
      const d = defaults[key] as { value?: unknown } | undefined
      if (d) {
        filled[key] = (
          typeof d === 'object' && d !== null && 'value' in d ? d.value : d
        ) as PropsT[Extract<keyof PropsT, string>]
      }
    }
  }
  return Object.freeze({ ...props, ...filled })
}

function isViewportInZoomBounds(
  zoom: number,
  minZoom: number | null,
  maxZoom: number | null,
): boolean {
  if (minZoom != null && zoom < minZoom) return false
  if (maxZoom != null && zoom > maxZoom) return false
  return true
}

/** Bounds visibili ∩ dominio dati; se disgiunti, l'intero dominio. */
function spawnBounds(viewport: WebMercatorViewport, data: Bounds4): Bounds4 {
  const vb = viewport.getBounds()
  const out: Bounds4 = [
    Math.max(vb[0], data[0]),
    Math.max(vb[1], data[1]),
    Math.min(vb[2], data[2]),
    Math.min(vb[3], data[3]),
  ]
  return out[0] < out[2] && out[1] < out[3] ? out : data
}

export class WindParticleLineLayer<ExtraPropsT extends {} = {}> extends LineLayer<
  unknown,
  ExtraPropsT & Required<_WindParticleLineLayerProps>
> {
  static layerName = 'WindParticleLineLayer'
  static defaultProps = defaultProps

  declare state: LineLayer['state'] & {
    initialized?: boolean
    currentNumParticles?: number
    numInstances?: number
    numAgedInstances?: number
    sourcePositions?: Buffer
    targetPositions?: Buffer
    sourceColors?: Buffer
    targetColors?: Buffer
    opacities?: Buffer
    transform?: BufferTransform
    previousViewportZoom?: number
    previousTime?: number
    paletteTexture?: Texture
    paletteBounds?: [number, number]
  }

  getShaders(): ReturnType<LineLayer['getShaders']> {
    const parentShaders = super.getShaders()
    return {
      ...parentShaders,
      inject: {
        ...parentShaders.inject,
        'vs:#decl':
          (parentShaders.inject?.['vs:#decl'] || '') +
          `
          in float instanceOpacities;
          out float drop;
          const float DROP_POSITION_Z = -1.;
        `,
        'vs:#main-start':
          (parentShaders.inject?.['vs:#main-start'] || '') +
          `
          drop = float(instanceSourcePositions.z == DROP_POSITION_Z || instanceTargetPositions.z == DROP_POSITION_Z);
        `,
        'vs:DECKGL_FILTER_COLOR':
          (parentShaders.inject?.['vs:DECKGL_FILTER_COLOR'] || '') +
          `
          color.a = color.a * instanceOpacities;
        `,
        'fs:#decl':
          (parentShaders.inject?.['fs:#decl'] || '') +
          `
          in float drop;
        `,
        'fs:#main-start':
          (parentShaders.inject?.['fs:#main-start'] || '') +
          `
          if (drop > 0.5) discard;
        `,
      },
    }
  }

  initializeState(): void {
    super.initializeState()

    const attributeManager = this.getAttributeManager()!
    attributeManager.remove([
      'instanceSourcePositions',
      'instanceTargetPositions',
      'instanceColors',
      'instanceWidths',
    ])
    attributeManager.addInstanced({
      instanceSourcePositions: { size: 3, type: 'float32', noAlloc: true },
      instanceTargetPositions: { size: 3, type: 'float32', noAlloc: true },
      instanceColors: { size: 4, type: 'float32', noAlloc: true },
      instanceOpacities: { size: 1, type: 'float32', noAlloc: true },
    })
  }

  updateState(params: UpdateParameters<this>): void {
    const { numParticles, maxAge, width, palette, visible } = params.props

    super.updateState(params)

    if (!visible || !numParticles || !maxAge || !width) {
      this._deleteTransformFeedback()
      return
    }

    if (
      numParticles !== params.oldProps.numParticles ||
      maxAge !== params.oldProps.maxAge ||
      width !== params.oldProps.width ||
      visible !== params.oldProps.visible
    ) {
      this._setupTransformFeedback()
    }

    if (palette !== params.oldProps.palette) {
      this._updatePalette()
    }
  }

  finalizeState(context: LayerContext): void {
    this._deleteTransformFeedback()
    super.finalizeState(context)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- firma di LineLayer.draw
  draw(opts: any): void {
    const { initialized } = this.state
    if (!initialized) {
      return
    }

    const { viewport } = this.context
    const { model } = this.state
    const { minZoom, maxZoom, width, animate } = ensureDefaultProps(
      this.props,
      defaultProps,
    )
    const { sourcePositions, targetPositions, sourceColors, opacities } =
      this.state
    if (!sourcePositions || !targetPositions || !sourceColors || !opacities) {
      return
    }

    if (model && isViewportInZoomBounds(viewport.zoom, minZoom, maxZoom)) {
      model.setAttributes({
        instanceSourcePositions: sourcePositions,
        instanceTargetPositions: targetPositions,
        instanceColors: sourceColors,
        instanceOpacities: opacities,
      })
      model.setConstantAttributes({
        instanceSourcePositions64Low: new Float32Array([0, 0, 0]),
        instanceTargetPositions64Low: new Float32Array([0, 0, 0]),
        instanceWidths: new Float32Array([width]),
      })

      super.draw(opts)

      if (animate) {
        this.step()
      }
    }
  }

  private _setupTransformFeedback(): void {
    const { device } = this.context
    const { initialized } = this.state
    if (initialized) {
      this._deleteTransformFeedback()
    }

    const { numParticles, maxAge } = ensureDefaultProps(this.props, defaultProps)

    // multiplo di 4 per l'allineamento dei copyBufferToBuffer (16 byte)
    const currentNumParticles = Math.max(4, Math.floor(numParticles / 4) * 4)

    // layout buffer: |age0|age1|...|age(N-1)|, ogni blocco = tutte le particelle
    const numInstances = currentNumParticles * maxAge
    const numAgedInstances = currentNumParticles * (maxAge - 1)
    const sourcePositions = device.createBuffer(new Float32Array(numInstances * 3))
    const targetPositions = device.createBuffer(new Float32Array(numInstances * 3))
    const sourceColors = device.createBuffer(new Float32Array(numInstances * 4))
    const targetColors = device.createBuffer(new Float32Array(numInstances * 4))
    const opacities = device.createBuffer(
      new Float32Array(
        new Array(numInstances).fill(undefined).map((_, i) => {
          const particleAge = Math.floor(i / currentNumParticles)
          return 1 - particleAge / maxAge
        }),
      ),
    )

    // transform feedback: aggiorna solo le particelle age0
    const transform = new BufferTransform(device, {
      vs: UPDATE_VS,
      modules: [bitmapModule, rasterModule, paletteModule, particleModule],
      vertexCount: currentNumParticles,

      attributes: {
        [SOURCE_POSITION]: sourcePositions,
        [SOURCE_COLOR]: sourceColors,
      },
      bufferLayout: [
        { name: SOURCE_POSITION, format: 'float32x3' },
        { name: SOURCE_COLOR, format: 'float32x4' },
      ],

      feedbackBuffers: {
        [TARGET_POSITION]: targetPositions,
        [TARGET_COLOR]: targetColors,
      },
      varyings: [TARGET_POSITION, TARGET_COLOR],
    })

    this.setState({
      initialized: true,
      currentNumParticles,
      numInstances,
      numAgedInstances,
      sourcePositions,
      targetPositions,
      sourceColors,
      targetColors,
      opacities,
      transform,
      previousViewportZoom: 0,
      previousTime: 0,
    })
  }

  private _runTransformFeedback(): void {
    const { initialized } = this.state
    if (!initialized) {
      return
    }

    const { device, viewport, timeline } = this.context
    const {
      imageTexture,
      imageSmoothing,
      imageInterpolation,
      imageUnscale,
      bounds,
      color,
      maxAge,
      speedFactor,
      groundPlane,
      altitude,
    } = ensureDefaultProps(this.props, defaultProps)
    const {
      paletteTexture,
      paletteBounds,
      currentNumParticles,
      numAgedInstances,
      sourcePositions,
      targetPositions,
      sourceColors,
      targetColors,
      transform,
      previousViewportZoom,
      previousTime,
    } = this.state
    if (
      !imageTexture ||
      typeof currentNumParticles !== 'number' ||
      typeof numAgedInstances !== 'number' ||
      !sourcePositions ||
      !targetPositions ||
      !sourceColors ||
      !targetColors ||
      !transform
    ) {
      return
    }

    const time = timeline.getTime()
    if (typeof previousTime === 'number' && time < previousTime + 1000 / FPS) {
      return
    }

    // respawn dentro viewport ∩ dominio dati (patch UrbanScope3D)
    const viewportBounds = spawnBounds(
      viewport as WebMercatorViewport,
      bounds as Bounds4,
    )
    const viewportZoomChangeFactor =
      2 **
      ((typeof previousViewportZoom === 'number'
        ? previousViewportZoom - viewport.zoom
        : 0) *
        4)

    // speed factor per lo zoom corrente
    const currentSpeedFactor = speedFactor / 2 ** (viewport.zoom + 7)

    const gp = groundPlane ?? [0, 0, 0]

    transform.model.shaderInputs.setProps({
      [bitmapModule.name]: {
        bounds: bounds as Bounds4,
      } satisfies BitmapModuleProps,
      [rasterModule.name]: {
        imageTexture,
        imageTexture2: imageTexture,
        imageSmoothing,
        imageInterpolation,
        imageUnscale,
      } satisfies Partial<RasterModuleProps>,
      [paletteModule.name]: {
        paletteTexture: paletteTexture ?? createEmptyTextureCached(device),
        paletteBounds,
        paletteColor: color
          ? [color[0] / 255, color[1] / 255, color[2] / 255, (color[3] ?? 255) / 255]
          : [1, 1, 1, 1],
      } satisfies PaletteModuleProps,
      [particleModule.name]: {
        viewportBounds,
        groundPlane: [gp[0], gp[1], gp[2], altitude],
        viewportZoomChangeFactor,
        numParticles: currentNumParticles,
        maxAge,
        speedFactor: currentSpeedFactor,
        time,
        seed: Math.random(),
      } satisfies ParticleModuleProps,
    })
    transform.run({
      clearColor: false,
      clearDepth: false,
      clearStencil: false,
      depthReadOnly: true,
      stencilReadOnly: true,
    })

    // barriera GPU: i write del transform feedback devono essere visibili al
    // copyBufferToBuffer successivo anche su GPU senza sync implicita
    const gl = (device as unknown as { gl: WebGL2RenderingContext }).gl
    if (gl) {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!
      gl.flush()
      gl.waitSync(sync, 0, gl.TIMEOUT_IGNORED)
      gl.deleteSync(sync)
    }

    const commandEncoder = device.createCommandEncoder()

    // shift eta': copia age0-age(N-2) in age1-age(N-1)
    commandEncoder.copyBufferToBuffer({
      sourceBuffer: sourcePositions,
      sourceOffset: 0,
      destinationBuffer: targetPositions,
      destinationOffset: currentNumParticles * Float32Array.BYTES_PER_ELEMENT * 3,
      size: numAgedInstances * Float32Array.BYTES_PER_ELEMENT * 3,
    })
    commandEncoder.copyBufferToBuffer({
      sourceBuffer: sourceColors,
      sourceOffset: 0,
      destinationBuffer: targetColors,
      destinationOffset: currentNumParticles * Float32Array.BYTES_PER_ELEMENT * 4,
      size: numAgedInstances * Float32Array.BYTES_PER_ELEMENT * 4,
    })

    const commandBuffer = commandEncoder.finish()
    device.submit(commandBuffer)
    commandEncoder.destroy()

    this._swapTransformFeedback()

    this.state.previousViewportZoom = viewport.zoom
    this.state.previousTime = time
  }

  // vedi https://github.com/visgl/luma.gl/pull/1883
  private _swapTransformFeedback(): void {
    const { sourcePositions, targetPositions, sourceColors, targetColors, transform } =
      this.state
    if (!sourcePositions || !targetPositions || !sourceColors || !targetColors || !transform) {
      return
    }

    this.state.sourcePositions = targetPositions
    this.state.targetPositions = sourcePositions
    this.state.sourceColors = targetColors
    this.state.targetColors = sourceColors

    transform.model.setAttributes({
      [SOURCE_POSITION]: targetPositions,
      [SOURCE_COLOR]: targetColors,
    })
    transform.transformFeedback.setBuffers({
      [TARGET_POSITION]: sourcePositions,
      [TARGET_COLOR]: sourceColors,
    })
  }

  private _deleteTransformFeedback(): void {
    const { initialized } = this.state
    if (!initialized) {
      return
    }

    const { sourcePositions, targetPositions, sourceColors, targetColors, opacities, transform } =
      this.state
    if (!sourcePositions || !targetPositions || !sourceColors || !targetColors || !opacities || !transform) {
      return
    }

    sourcePositions.destroy()
    targetPositions.destroy()
    sourceColors.destroy()
    targetColors.destroy()
    opacities.destroy()
    transform.destroy()

    this.setState({
      initialized: false,
      currentNumParticles: undefined,
      sourcePositions: undefined,
      targetPositions: undefined,
      sourceColors: undefined,
      targetColors: undefined,
      opacities: undefined,
      transform: undefined,
    })
  }

  private _updatePalette(): void {
    const { device } = this.context
    const { palette } = ensureDefaultProps(this.props, defaultProps)
    if (!palette || palette.length < 2) {
      this.setState({ paletteTexture: undefined, paletteBounds: undefined })
      return
    }

    const { paletteBounds, paletteTexture } = createPaletteTexture(device, palette)
    this.setState({ paletteTexture, paletteBounds })
  }

  step(): void {
    this._runTransformFeedback()
    this.setNeedsRedraw()
  }
}
