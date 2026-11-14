const MEDIA_CONTENT_TYPES: Record<string, string> = {
    webm: 'audio/webm',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
}

export function mediaContentType(path: string): string | null {
    const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
    return MEDIA_CONTENT_TYPES[ext] ?? null
}

const INLINE_CONTENT_TYPES: Record<string, string> = {
    ...MEDIA_CONTENT_TYPES,
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    pdf: 'application/pdf',
}

const INLINE_SAFE_PREFIXES = ['image/', 'audio/', 'video/']
const INLINE_UNSAFE_IMAGES = new Set(['image/svg+xml'])

export function isInlineSafeContentType(contentType: string): boolean {
    const bare = contentType.split(';')[0]!.trim().toLowerCase()
    if (bare === 'application/pdf') return true
    return INLINE_SAFE_PREFIXES.some(prefix => bare.startsWith(prefix)) && !INLINE_UNSAFE_IMAGES.has(bare)
}

export function fileResponseHeaders(contentType: string, name: string): Record<string, string> {
    const inline = isInlineSafeContentType(contentType)
    const filename = `filename*=UTF-8''${encodeURIComponent(name)}`
    return {
        'Content-Type': inline ? contentType : 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; ${filename}`,
        'X-Content-Type-Options': 'nosniff',
        ...(inline ? {} : { 'Content-Security-Policy': "default-src 'none'; sandbox" }),
    }
}

export function rawFileHeaders(path: string): Record<string, string> {
    const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
    const name = path.split('/').pop() || 'file'
    const contentType = INLINE_CONTENT_TYPES[ext] ?? (ext === 'svg' ? 'image/svg+xml' : 'application/octet-stream')
    return { ...fileResponseHeaders(contentType, name), 'Content-Type': contentType }
}

const SITE_CONTENT_TYPES: Record<string, string> = {
    ...MEDIA_CONTENT_TYPES,
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    json: 'application/json',
    map: 'application/json',
    webmanifest: 'application/manifest+json',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    xml: 'application/xml',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    wasm: 'application/wasm',
    pdf: 'application/pdf',
    mp4: 'video/mp4',
    webm: 'video/webm',
}

export function siteContentType(path: string): string {
    const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
    return withUtf8Charset(SITE_CONTENT_TYPES[ext] ?? 'application/octet-stream')
}

export function withUtf8Charset(contentType: string): string {
    if (!contentType.startsWith('text/') || /;\s*charset=/i.test(contentType)) return contentType
    return `${contentType}; charset=utf-8`
}
