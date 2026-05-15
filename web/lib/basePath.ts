// Helper centralizzato per prefissare URL statici quando il sito vive
// sotto un basePath (GitHub Pages: /UrbanScope3D). In locale BASE_PATH e'
// vuoto e i path restano assoluti come prima.
export const BASE_PATH: string = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export function withBase(path: string): string {
  if (!path.startsWith('/')) return path
  return `${BASE_PATH}${path}`
}
