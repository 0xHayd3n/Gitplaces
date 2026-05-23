// Pick a deterministic static-dither camera index per repo so two repos by
// the same owner (sharing an avatar URL) show visibly different crops rather
// than pixel-identical banners. djb2 hash mod 4 — one of the 4 cameras in
// useBayerDither's CAMERAS array.

const CAMERA_COUNT = 4

export function cameraIdxForRepo(owner: string, name: string): number {
  const key = `${owner}/${name}`
  let h = 5381
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) | 0
  }
  return Math.abs(h) % CAMERA_COUNT
}
