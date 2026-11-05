export type ViewerKind = 'markdown' | 'slides' | 'csv' | 'pdf' | 'image' | 'video' | 'audio' | 'file'

// What the engine labels a file is often application/octet-stream, so the extension settles it.
const BY_EXTENSION: Record<string, ViewerKind> = {
    md: 'markdown',
    markdown: 'markdown',
    csv: 'csv',
    tsv: 'csv',
    pdf: 'pdf',
    png: 'image',
    jpg: 'image',
    jpeg: 'image',
    gif: 'image',
    webp: 'image',
    avif: 'image',
    svg: 'image',
    mp4: 'video',
    webm: 'video',
    mov: 'video',
    mp3: 'audio',
    m4a: 'audio',
    wav: 'audio',
    ogg: 'audio',
    flac: 'audio',
}

export function extensionOf(path: string): string {
    const name = path.split('/').pop() ?? ''
    const dot = name.lastIndexOf('.')
    return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function fileNameOf(path: string): string {
    return path.split('/').pop() || path
}

export function viewerKindOf(contentType: string, path: string): ViewerKind {
    const type = contentType.split(';')[0].trim().toLowerCase()
    if (type === 'text/markdown') return 'markdown'
    if (type === 'text/csv' || type === 'text/tab-separated-values') return 'csv'
    if (type === 'application/pdf') return 'pdf'
    if (type.startsWith('image/')) return 'image'
    if (type.startsWith('video/')) return 'video'
    if (type.startsWith('audio/')) return 'audio'
    return BY_EXTENSION[extensionOf(path)] ?? 'file'
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const SLIDES_FLAG = /^(marp|slides)\s*:\s*true\s*$/im

// A Markdown file is a deck only when it says so: named `*.slides.md`, or a frontmatter carrying
// `marp: true` or `slides: true`. A plain document full of `---` rules stays a document.
export function isMarkdownDeck(path: string, markdown: string): boolean {
    if (fileNameOf(path).toLowerCase().endsWith('.slides.md')) return true
    const frontmatter = FRONTMATTER.exec(markdown)?.[1]
    return !!frontmatter && SLIDES_FLAG.test(frontmatter)
}

// Slides are split on lines that are exactly `---`, never inside a fenced code block; the
// frontmatter is dropped, and so are empty slides.
export function splitMarkdownSlides(markdown: string): string[] {
    const body = markdown.replace(FRONTMATTER, '')
    const slides: string[] = []
    let current: string[] = []
    let fenced = false
    for (const line of body.split(/\r?\n/)) {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
        if (!fenced && line.trim() === '---') {
            slides.push(current.join('\n'))
            current = []
            continue
        }
        current.push(line)
    }
    slides.push(current.join('\n'))
    return slides.filter(slide => slide.trim() !== '')
}
