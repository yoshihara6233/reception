import { Font } from '@react-pdf/renderer'
import path from 'path'

let registered = false

export function registerFonts() {
  if (registered) return
  registered = true

  const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf')

  Font.register({
    family: 'NotoSansJP',
    fonts: [
      { src: fontPath, fontWeight: 400 },
    ],
  })

  // Hyphenation off (Japanese doesn't hyphenate)
  Font.registerHyphenationCallback(word => [word])
}
