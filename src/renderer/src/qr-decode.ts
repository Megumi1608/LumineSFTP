import jsQR from 'jsqr'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_DIMENSION = 1600

export type QrDecodeErrorCode = 'QR_TOO_LARGE' | 'QR_UNSUPPORTED' | 'QR_NOT_FOUND'

export class QrDecodeError extends Error {
  constructor(readonly code: QrDecodeErrorCode) {
    super(code)
    this.name = 'QrDecodeError'
  }
}

export async function decodeQrFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new QrDecodeError('QR_TOO_LARGE')
  if (file.type && !file.type.startsWith('image/')) {
    throw new QrDecodeError('QR_UNSUPPORTED')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new QrDecodeError('QR_UNSUPPORTED')
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new QrDecodeError('QR_UNSUPPORTED')
    context.drawImage(bitmap, 0, 0, width, height)

    const image = context.getImageData(0, 0, width, height)
    const result = jsQR(image.data, image.width, image.height, {
      inversionAttempts: 'attemptBoth'
    })
    if (!result?.data) throw new QrDecodeError('QR_NOT_FOUND')
    return result.data
  } finally {
    bitmap.close()
  }
}
