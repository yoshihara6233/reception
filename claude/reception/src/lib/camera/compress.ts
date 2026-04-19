const MAX_SIZE_BYTES = 500 * 1024 // 500KB

export async function compressImage(file: File): Promise<Blob> {
  const img = await createImageBitmap(file)

  // Scale down if needed
  const maxDim = 1200
  let { width, height } = img
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)

  // Try decreasing quality until under MAX_SIZE_BYTES
  let quality = 0.8
  let blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })

  while (blob.size > MAX_SIZE_BYTES && quality > 0.1) {
    quality -= 0.1
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  }

  return blob
}
