/*
 * Sorgenti GLSL del motore particelle GPU, derivati da WeatherLayers GL
 * (https://github.com/weatherlayers/weatherlayers-gl), Mozilla Public
 * License 2.0. This Source Code Form is subject to the terms of the MPL-2.0:
 * http://mozilla.org/MPL/2.0/. Copyright (c) WeatherLayers.com.
 *
 * Modifiche locali (UrbanScope3D):
 *  - le particelle vivono in 3D: la quota e' calcolata NEL VERTEX SHADER di
 *    update dal piano del suolo ENVI-met (z = a + b*lon + c*lat) piu' la quota
 *    relativa dello slider (uniform `groundPlane`), cosi' terreno ed edifici
 *    le occludono correttamente nella scena MapLibre+deck interleaved;
 *  - niente proiezione globe (la scena e' sempre Web Mercator);
 *  - gli @include della build rollup sono inlinati come stringhe TS.
 */

/** pixel.glsl — campionamento manuale (nearest/bilineare/bicubico) della texture. */
const PIXEL = /* glsl */ `
vec4 getPixel(sampler2D image, vec2 imageDownscaleResolution, vec2 iuv, vec2 offset) {
  vec2 uv = (iuv + offset + 0.5) / imageDownscaleResolution;

  return texture(image, uv);
}

// cubic B-spline
const vec4 BS_A = vec4( 3.0, -6.0,   0.0, 4.0) / 6.0;
const vec4 BS_B = vec4(-1.0,  6.0, -12.0, 8.0) / 6.0;

vec4 powers(float x) {
  return vec4(x*x*x, x*x, x, 1.0);
}

vec4 spline(vec4 c0, vec4 c1, vec4 c2, vec4 c3, float a) {
  vec4 color =
    c0 * dot(BS_B, powers(a + 1.)) +
    c1 * dot(BS_A, powers(a     )) +
    c2 * dot(BS_A, powers(1. - a)) +
    c3 * dot(BS_B, powers(2. - a));

  // fix precision loss in alpha channel
  color.a = (c0.a > 0. && c1.a > 0. && c2.a > 0. && c3.a > 0.) ? max(max(max(c0.a, c1.a), c2.a), c3.a) : 0.;

  return color;
}

vec4 getPixelCubic(sampler2D image, vec2 imageDownscaleResolution, vec2 uv) {
  vec2 tuv = uv * imageDownscaleResolution - 0.5;
  vec2 iuv = floor(tuv);
  vec2 fuv = fract(tuv);

  return spline(
    spline(getPixel(image, imageDownscaleResolution, iuv, vec2(-1, -1)), getPixel(image, imageDownscaleResolution, iuv, vec2(0, -1)), getPixel(image, imageDownscaleResolution, iuv, vec2(1, -1)), getPixel(image, imageDownscaleResolution, iuv, vec2(2, -1)), fuv.x),
    spline(getPixel(image, imageDownscaleResolution, iuv, vec2(-1,  0)), getPixel(image, imageDownscaleResolution, iuv, vec2(0,  0)), getPixel(image, imageDownscaleResolution, iuv, vec2(1,  0)), getPixel(image, imageDownscaleResolution, iuv, vec2(2,  0)), fuv.x),
    spline(getPixel(image, imageDownscaleResolution, iuv, vec2(-1,  1)), getPixel(image, imageDownscaleResolution, iuv, vec2(0,  1)), getPixel(image, imageDownscaleResolution, iuv, vec2(1,  1)), getPixel(image, imageDownscaleResolution, iuv, vec2(2,  1)), fuv.x),
    spline(getPixel(image, imageDownscaleResolution, iuv, vec2(-1,  2)), getPixel(image, imageDownscaleResolution, iuv, vec2(0,  2)), getPixel(image, imageDownscaleResolution, iuv, vec2(1,  2)), getPixel(image, imageDownscaleResolution, iuv, vec2(2,  2)), fuv.x),
    fuv.y
  );
}

vec4 getPixelLinear(sampler2D image, vec2 imageDownscaleResolution, vec2 uv) {
  vec2 tuv = uv * imageDownscaleResolution - 0.5;
  vec2 iuv = floor(tuv);
  vec2 fuv = fract(tuv);

  return mix(
    mix(getPixel(image, imageDownscaleResolution, iuv, vec2(0, 0)), getPixel(image, imageDownscaleResolution, iuv, vec2(1, 0)), fuv.x),
    mix(getPixel(image, imageDownscaleResolution, iuv, vec2(0, 1)), getPixel(image, imageDownscaleResolution, iuv, vec2(1, 1)), fuv.x),
    fuv.y
  );
}

vec4 getPixelNearest(sampler2D image, vec2 imageDownscaleResolution, vec2 uv) {
  vec2 tuv = uv * imageDownscaleResolution - 0.5;
  vec2 iuv = floor(tuv + 0.5); // nearest

  return getPixel(image, imageDownscaleResolution, iuv, vec2(0, 0));
}

vec4 getPixelFilter(sampler2D image, vec2 imageDownscaleResolution, float imageInterpolation, vec2 uv) {
  if (imageInterpolation == 2.) {
    return getPixelCubic(image, imageDownscaleResolution, uv);
  } if (imageInterpolation == 1.) {
    return getPixelLinear(image, imageDownscaleResolution, uv);
  } else {
    return getPixelNearest(image, imageDownscaleResolution, uv);
  }
}

vec4 getPixelInterpolate(sampler2D image, sampler2D image2, vec2 imageDownscaleResolution, float imageInterpolation, float imageWeight, bool isRepeatBounds, vec2 uv) {
  vec2 uvWithOffset;
  uvWithOffset.x = isRepeatBounds ?
    uv.x + 0.5 / imageDownscaleResolution.x :
    mix(0. + 0.5 / imageDownscaleResolution.x, 1. - 0.5 / imageDownscaleResolution.x, uv.x);
  uvWithOffset.y =
    mix(0. + 0.5 / imageDownscaleResolution.y, 1. - 0.5 / imageDownscaleResolution.y, uv.y);

  if (imageWeight > 0.) {
    vec4 pixel = getPixelFilter(image, imageDownscaleResolution, imageInterpolation, uvWithOffset);
    vec4 pixel2 = getPixelFilter(image2, imageDownscaleResolution, imageInterpolation, uvWithOffset);
    return mix(pixel, pixel2, imageWeight);
  } else {
    return getPixelFilter(image, imageDownscaleResolution, imageInterpolation, uvWithOffset);
  }
}

vec4 getPixelSmoothInterpolate(sampler2D image, sampler2D image2, vec2 imageResolution, float imageSmoothing, float imageInterpolation, float imageWeight, bool isRepeatBounds, vec2 uv) {
  // smooth by downscaling resolution
  float imageDownscaleResolutionFactor = 1. + max(0., imageSmoothing);
  vec2 imageDownscaleResolution = imageResolution / imageDownscaleResolutionFactor;

  return getPixelInterpolate(image, image2, imageDownscaleResolution, imageInterpolation, imageWeight, isRepeatBounds, uv);
}
`

/** pixel-value.glsl — da pixel RGBA a valore fisico (scala imageUnscale, nodata). */
const PIXEL_VALUE = /* glsl */ `
const float _PI_ = 3.1415926536;

float atan2(float y, float x) {
  return x == 0. ? sign(y) * _PI_ / 2. : atan(y, x);
}

bool isNaN(float value) {
  uint valueUint = floatBitsToUint(value);
  return (valueUint & 0x7fffffffu) > 0x7f800000u;
}

bool hasPixelValue(vec4 pixel, vec2 imageUnscale) {
  if (imageUnscale[0] < imageUnscale[1]) {
    return pixel.a >= 1.;
  } else {
    return !isNaN(pixel.x);
  }
}

float getPixelScalarValue(vec4 pixel, float imageType, vec2 imageUnscale) {
  if (imageType == 1.) {
    return 0.;
  } else {
    if (imageUnscale[0] < imageUnscale[1]) {
      return mix(imageUnscale[0], imageUnscale[1], pixel.x);
    } else {
      return pixel.x;
    }
  }
}

vec2 getPixelVectorValue(vec4 pixel, float imageType, vec2 imageUnscale) {
  if (imageType == 1.) {
    if (imageUnscale[0] < imageUnscale[1]) {
      return mix(vec2(imageUnscale[0]), vec2(imageUnscale[1]), pixel.xy);
    } else {
      return pixel.xy;
    }
  } else {
    return vec2(0.);
  }
}

float getPixelMagnitudeValue(vec4 pixel, float imageType, vec2 imageUnscale) {
  if (imageType == 1.) {
    vec2 value = getPixelVectorValue(pixel, imageType, imageUnscale);
    return length(value);
  } else {
    return getPixelScalarValue(pixel, imageType, imageUnscale);
  }
}
`

/** bitmap-module.glsl — bounds del raster e conversione uv. */
export const BITMAP_MODULE_GLSL = /* glsl */ `
layout(std140) uniform bitmap2Uniforms {
  vec4 bounds;
  bool isRepeatBounds;
  float coordinateConversion;
  vec4 transparentColor;
} bitmap2;

vec2 getUV(vec2 pos) {
  return vec2(
    (pos.x - bitmap2.bounds[0]) / (bitmap2.bounds[2] - bitmap2.bounds[0]),
    (pos.y - bitmap2.bounds[3]) / (bitmap2.bounds[1] - bitmap2.bounds[3])
  );
}
`

/** raster-module.glsl — texture e parametri di campionamento. */
export const RASTER_MODULE_GLSL = /* glsl */ `
uniform sampler2D imageTexture;
uniform sampler2D imageTexture2;

layout(std140) uniform rasterUniforms {
  vec2 imageResolution;
  float imageSmoothing;
  float imageInterpolation;
  float imageWeight;
  float imageType;
  vec2 imageUnscale;
  float imageMinValue;
  float imageMaxValue;
} raster;
`

/** palette-module.glsl — colore per velocita' dalla texture rampa. */
export const PALETTE_MODULE_GLSL = /* glsl */ `
uniform sampler2D paletteTexture;

layout(std140) uniform paletteUniforms {
  vec2 paletteBounds;
  vec4 paletteColor;
} palette;

float getPaletteValue(float min, float max, float value) {
  return (value - min) / (max - min);
}

vec4 applyPalette(sampler2D paletteTexture, vec2 paletteBounds, vec4 paletteColor, float value) {
  if (paletteBounds[0] < paletteBounds[1]) {
    float paletteValue = getPaletteValue(paletteBounds[0], paletteBounds[1], value);
    return texture(paletteTexture, vec2(paletteValue, 0.));
  } else {
    return paletteColor;
  }
}
`

/** particle-module.glsl — con groundPlane (patch 3D UrbanScope3D). */
export const PARTICLE_MODULE_GLSL = /* glsl */ `
layout(std140) uniform particleUniforms {
  vec4 viewportBounds;
  vec4 groundPlane;
  float viewportZoomChangeFactor;
  float numParticles;
  float maxAge;
  float speedFactor;
  float time;
  float seed;
} particle;
`

/**
 * Vertex shader di UPDATE (transform feedback): avanza le particelle age0
 * campionando il campo u/v dalla texture. Le quote (patch 3D) sono scritte
 * direttamente in targetPosition.z.
 */
export const UPDATE_VS = /* glsl */ `#version 300 es
#define SHADER_NAME wind-particle-update-vertex-shader

#ifdef GL_ES
precision highp float;
#endif

${PIXEL}
${PIXEL_VALUE}

in vec3 sourcePosition;
in vec4 sourceColor;
out vec3 targetPosition;
out vec4 targetColor;

const float DROP_POSITION_Z = -1.;
const vec4 HIDE_COLOR = vec4(0);

float wrapLongitude(float lng) {
  float wrappedLng = mod(lng + 180., 360.) - 180.;
  return wrappedLng;
}

float wrapLongitude(float lng, float minLng) {
  float wrappedLng = wrapLongitude(lng);
  if (wrappedLng < minLng) {
    wrappedLng += 360.;
  }
  return wrappedLng;
}

float randFloat(vec2 seed) {
  return fract(sin(dot(seed.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 randPoint(vec2 seed) {
  return vec2(randFloat(seed + 1.3), randFloat(seed + 2.1));
}

// Solo Web Mercator: punto casuale nei bounds visibili (gia' intersecati col dominio dati).
vec2 randPointToPosition(vec2 point) {
  point.y = smoothstep(0., 1., point.y); // uniform random latitude
  vec2 viewportBoundsMin = particle.viewportBounds.xy;
  vec2 viewportBoundsMax = particle.viewportBounds.zw;
  return mix(viewportBoundsMin, viewportBoundsMax, point);
}

vec2 movePositionBySpeed(vec2 position, vec2 speed) {
  float distortion = cos(radians(position.y));
  vec2 offset = vec2(speed.x, speed.y * distortion); // slower latitude
  return position + offset;
}

bool isPositionInBounds(vec2 position, vec4 bounds) {
  vec2 boundsMin = bounds.xy;
  vec2 boundsMax = bounds.zw;
  float lng = wrapLongitude(position.x, boundsMin.x);
  float lat = position.y;
  return (
    boundsMin.x <= lng && lng <= boundsMax.x &&
    boundsMin.y <= lat && lat <= boundsMax.y
  );
}

// PATCH 3D UrbanScope3D: quota suolo dal piano del dominio + quota relativa.
float groundZ(vec2 lonLat) {
  return particle.groundPlane.x
    + particle.groundPlane.y * lonLat.x
    + particle.groundPlane.z * lonLat.y
    + particle.groundPlane.w;
}

void main() {
  float particleIndex = mod(float(gl_VertexID), particle.numParticles);
  float particleAge = floor(float(gl_VertexID) / particle.numParticles);

  // update particles age0
  // older particles age1-age(N-1) are copied with buffer.copyData
  if (particleAge > 0.) {
    return;
  }

  if (sourcePosition.z == DROP_POSITION_Z) {
    // generate random position to prevent converging particles
    vec2 particleSeed = vec2(particleIndex * particle.seed / particle.numParticles);
    vec2 point = randPoint(particleSeed);
    vec2 position = randPointToPosition(point);
    targetPosition.xy = position;
    targetPosition.x = wrapLongitude(targetPosition.x);
    targetPosition.z = groundZ(targetPosition.xy);
    targetColor = HIDE_COLOR;
    return;
  }

  if (particle.viewportZoomChangeFactor > 1. && mod(particleIndex, particle.viewportZoomChangeFactor) >= 1.) {
    // drop when zooming out
    targetPosition.xy = sourcePosition.xy;
    targetPosition.z = DROP_POSITION_Z;
    targetColor = HIDE_COLOR;
    return;
  }

  if (abs(mod(particleIndex, particle.maxAge + 2.) - mod(particle.time, particle.maxAge + 2.)) < 1.) {
    // drop by maxAge, +2 because only non-randomized pairs are rendered
    targetPosition.xy = sourcePosition.xy;
    targetPosition.z = DROP_POSITION_Z;
    targetColor = HIDE_COLOR;
    return;
  }

  if (!isPositionInBounds(sourcePosition.xy, bitmap2.bounds)) {
    // drop out of bounds
    targetPosition.xy = sourcePosition.xy;
    targetPosition.z = DROP_POSITION_Z;
    targetColor = HIDE_COLOR;
    return;
  }

  vec2 uv = getUV(sourcePosition.xy); // imageTexture in COORDINATE_SYSTEM.LNGLAT
  vec4 pixel = getPixelSmoothInterpolate(imageTexture, imageTexture2, raster.imageResolution, raster.imageSmoothing, raster.imageInterpolation, raster.imageWeight, bitmap2.isRepeatBounds, uv);
  if (!hasPixelValue(pixel, raster.imageUnscale)) {
    // drop nodata
    targetPosition.xy = sourcePosition.xy;
    targetPosition.z = DROP_POSITION_Z;
    targetColor = HIDE_COLOR;
    return;
  }

  float value = getPixelMagnitudeValue(pixel, raster.imageType, raster.imageUnscale);
  if (
    (!isNaN(raster.imageMinValue) && value < raster.imageMinValue) ||
    (!isNaN(raster.imageMaxValue) && value > raster.imageMaxValue)
  ) {
    // drop value out of bounds
    targetPosition.xy = sourcePosition.xy;
    targetPosition.z = DROP_POSITION_Z;
    targetColor = HIDE_COLOR;
    return;
  }

  // update position
  vec2 speed = getPixelVectorValue(pixel, raster.imageType, raster.imageUnscale) * particle.speedFactor;
  targetPosition.xy = movePositionBySpeed(sourcePosition.xy, speed);
  targetPosition.x = wrapLongitude(targetPosition.x);
  targetPosition.z = groundZ(targetPosition.xy);

  // update color
  targetColor = sourceColor; // dummy use so that sourceColor attribute is detected by shader layout introspection in WEBGLRenderPipeline
  targetColor = applyPalette(paletteTexture, palette.paletteBounds, palette.paletteColor, value);
}
`
