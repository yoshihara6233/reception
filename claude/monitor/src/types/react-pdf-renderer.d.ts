/**
 * Temporary ambient module declaration for @react-pdf/renderer.
 * Remove this file once `npm install` has been run and the real types
 * from the package's own declarations are available in node_modules.
 */
declare module '@react-pdf/renderer' {
  import type { ReactElement, ReactNode, CSSProperties } from 'react'

  // Style
  export type Style = CSSProperties & Record<string, unknown>
  export const StyleSheet: {
    create<T extends Record<string, Style>>(styles: T): T
  }

  // Font
  export const Font: {
    register(config: {
      family: string
      src: string
      fontStyle?: string
      fontWeight?: string | number
    }): void
  }

  // Primitive components
  interface CommonProps {
    style?: Style | Style[]
    children?: ReactNode
    fixed?: boolean
    wrap?: boolean
    break?: boolean
    debug?: boolean
    id?: string
  }

  export function Document(props: CommonProps & {
    title?: string
    author?: string
    subject?: string
    keywords?: string
    creator?: string
    producer?: string
    language?: string
  }): ReactElement
  export function Page(props: CommonProps & {
    size?: string | [number, number]
    orientation?: 'portrait' | 'landscape'
    dpi?: number
  }): ReactElement
  export function View(props: CommonProps & { key?: string }): ReactElement
  export function Text(props: CommonProps & {
    key?: string
    render?: (opts: { pageNumber: number; totalPages: number }) => ReactNode
    textAnchor?: string
  }): ReactElement
  export function Image(props: CommonProps & {
    src: string | { uri: string; method?: string; headers?: Record<string, string>; body?: string }
    cache?: boolean
  }): ReactElement
  export function Link(props: CommonProps & { src: string }): ReactElement
  export function Note(props: CommonProps): ReactElement
  export function Canvas(props: CommonProps & {
    paint?: (painter: unknown, availableWidth: number, availableHeight: number) => void
  }): ReactElement

  // Render
  export function renderToBuffer(element: ReactElement): Promise<Uint8Array>
  export function renderToStream(element: ReactElement): NodeJS.ReadableStream
  export function renderToString(element: ReactElement): Promise<string>
  export function usePDF(options: { document: ReactElement }): [
    { loading: boolean; blob: Blob | null; url: string | null; error: string | null },
    () => void,
  ]
  export function PDFViewer(props: CommonProps & {
    width?: string | number
    height?: string | number
    showToolbar?: boolean
    innerRef?: React.RefObject<HTMLIFrameElement>
  }): ReactElement
  export function PDFDownloadLink(props: {
    document: ReactElement
    fileName?: string
    style?: Style
    className?: string
    children?: ReactNode | ((state: { loading: boolean; blob: Blob | null; url: string | null; error: string | null }) => ReactNode)
  }): ReactElement
}
