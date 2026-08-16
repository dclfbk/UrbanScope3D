import type { NextConfig } from 'next'

// Su GitHub Pages il sito vive sotto `https://<user>.github.io/UrbanScope3D/`,
// quindi serve un basePath. In locale (`npm run dev`) la variabile e' vuota
// e l'app risponde sotto `/`. Il workflow Pages setta NEXT_PUBLIC_BASE_PATH
// a `/UrbanScope3D` prima della build.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

const nextConfig: NextConfig = {
  output: 'export',
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  // Solo dev: permette di aprire il dev server anche come http://127.0.0.1:3000
  // (alcuni browser/estensioni non risolvono localhost verso il server).
  allowedDevOrigins: ['127.0.0.1'],
}

export default nextConfig
