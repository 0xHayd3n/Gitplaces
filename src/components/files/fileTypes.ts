const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'ogg'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

export const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/mp4', ogg: 'video/ogg',
}

export function isVideoFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXTENSIONS.has(ext)
}

export function isPdfFile(filename: string): boolean {
  return filename.split('.').pop()?.toLowerCase() === 'pdf'
}

export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.has(ext)
}
