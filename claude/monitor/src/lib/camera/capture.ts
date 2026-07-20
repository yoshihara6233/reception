'use client'

/**
 * キオスク端末のカメラ制御（M3・standalone 版から移植）
 *
 * iPad 前面カメラでのプレビュー・静止画キャプチャ。顔認証（Rekognition）へ
 * 送る JPEG を canvas 経由で生成する。
 */

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

/**
 * @param zoom 1.0 = full frame, 2.0 = center crop at 2× zoom
 *             キオスクタブレット固定時は 2.0 で約50cm距離の顔にフィット
 * @param maxDim 出力の長辺上限(px)。指定すると縮小して JPEG を小さくする
 *              （アップロード/Rekognition の高速化。顔照合は 720 程度で十分）。
 */
export function captureFrame(videoElement: HTMLVideoElement, zoom = 1, maxDim?: number): Blob | null {
  const vw = videoElement.videoWidth
  const vh = videoElement.videoHeight
  // カメラ未準備（0×0）で撮ると空dataURLになり atob が例外を投げるため、null で返す
  // （呼び出し側は「カメラを起動できませんでした」を表示して再試行できる）。
  if (!vw || !vh) return null

  // 出力サイズ（長辺を maxDim で頭打ち・アスペクト比維持）。
  let outW = vw, outH = vh
  if (maxDim && Math.max(vw, vh) > maxDim) {
    const scale = maxDim / Math.max(vw, vh)
    outW = Math.round(vw * scale)
    outH = Math.round(vh * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  if (zoom > 1) {
    // Center-crop: show only the inner 1/zoom area, stretched to the output size
    const cropW = vw / zoom
    const cropH = vh / zoom
    const srcX = (vw - cropW) / 2
    const srcY = (vh - cropH) / 2
    ctx.drawImage(videoElement, srcX, srcY, cropW, cropH, 0, 0, outW, outH)
  } else {
    ctx.drawImage(videoElement, 0, 0, outW, outH)
  }

  // Convert to blob synchronously via dataURL for simplicity
  const dataUrl = canvas.toDataURL('image/jpeg', 0.75)
  const byteString = atob(dataUrl.split(',')[1])
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0]
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mimeString })
}

/** capture 済み Blob を JSON 送信用の base64 dataURL へ。 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export function stopCamera(stream: MediaStream) {
  stream.getTracks().forEach(track => track.stop())
}
