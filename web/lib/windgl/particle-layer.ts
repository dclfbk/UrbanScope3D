/*
 * WindParticleLayer — composite deck.gl che carica la texture u/v e monta il
 * WindParticleLineLayer. Derivato da WeatherLayers GL
 * (https://github.com/weatherlayers/weatherlayers-gl), MPL-2.0
 * (http://mozilla.org/MPL/2.0/). Copyright (c) WeatherLayers.com.
 */
import { CompositeLayer } from '@deck.gl/core'
import type {
  LayerProps,
  DefaultProps,
  UpdateParameters,
  LayersList,
} from '@deck.gl/core'
import type { Texture } from '@luma.gl/core'
import { createTextureCached } from './texture'
import type { TextureData } from './texture'
import { WindParticleLineLayer } from './particle-line-layer'
import type { WindParticleLineLayerProps } from './particle-line-layer'

type _WindParticleLayerProps = WindParticleLineLayerProps & {
  /** Griglia u/v: RGBA Uint8 (R = u, G = v scalati con imageUnscale, A = 255/0). */
  image: TextureData | null
}

export type WindParticleLayerProps = _WindParticleLayerProps & LayerProps

const defaultProps: DefaultProps<WindParticleLayerProps> = {
  ...WindParticleLineLayer.defaultProps,
  imageTexture: undefined,
  image: { type: 'object', value: null },
}

// `{}` ricalca la firma dei generics di deck.gl (ExtraPropsT extends {} = {}):
// cambiarlo in `object` divergerebbe dall'upstream WeatherLayers/deck.gl.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class WindParticleLayer<ExtraPropsT extends {} = {}> extends CompositeLayer<
  ExtraPropsT & Required<_WindParticleLayerProps>
> {
  static layerName = 'WindParticleLayer'
  static defaultProps = defaultProps

  declare state: CompositeLayer['state'] & {
    props?: WindParticleLayerProps
    imageTexture?: Texture
  }

  renderLayers(): LayersList {
    const { props, imageTexture } = this.state
    if (!props || !imageTexture) {
      return []
    }

    return [
      new WindParticleLineLayer(
        this.props,
        this.getSubLayerProps({
          id: 'line',
          data: [],
          imageTexture,
          parameters: {
            // depth test normale: edifici e terreno occludono le scie 3D
            depthCompare: 'less-equal',
            ...this.props.parameters,
          },
        } satisfies Partial<WindParticleLineLayerProps>),
      ),
    ]
  }

  updateState(params: UpdateParameters<this>): void {
    const { image, imageUnscale } = params.props

    super.updateState(params)

    if (
      image &&
      imageUnscale &&
      !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)
    ) {
      throw new Error('imageUnscale richiede dati Uint8')
    }

    if (image !== params.oldProps.image) {
      const { device } = this.context
      const imageTexture = image ? createTextureCached(device, image) : undefined
      this.setState({ imageTexture })
    }

    this.setState({ props: params.props })
  }
}
