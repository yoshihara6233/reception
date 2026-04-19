'use client'

export interface CameraOptions {
  facingMode: 'user' | 'environment' // 'user' = front, 'environment' = back
}

export async function startCamera(
  videoElement: HTMLVideoElement,
  options: CameraOptions
): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: options.facingMode,
      width: { ideal: 1280 },
      height: { ideal: 960 },
    },
    audio: false,
  })

  videoElement.srcObject = stream
  // play() can throw on iOS if called outside user-gesture context
  // With muted + playsInline + autoPlay attrs the browser handles it natively
  try {
    await videoElement.play()
  } catch {
    // autoPlay attribute on the element will handle playback; non-fatal
  }
  return stream
}

export function captureFrame(videoElement: HTMLVideoElement): Blob | null {
  const canvas = document.createElement('canvas')
  canvas.width = videoElement.videoWidth
  canvas.height = videoElement.videoHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(videoElement, 0, 0)

  // Convert to blob synchronously via dataURL for simplicity
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  const byteString = atob(dataUrl.split(',')[1])
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0]
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mimeString })
}

export function stopCamera(stream: MediaStream) {
  stream.getTracks().forEach(track => track.stop())
}
