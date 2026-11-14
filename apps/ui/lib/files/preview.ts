import { ArchiveIcon, AudioWaveformIcon, BinaryIcon, Code2, FilmIcon, type LucideIcon } from '@/lib/icons'

export type FilePreviewKind = 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'binary'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v'])
const BINARY_EXTS = new Set(['zip', 'gz', 'tar', 'rar', '7z', 'exe', 'bin', 'dmg', 'iso', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'parquet', 'sqlite', 'db', 'wasm', 'so', 'dylib', 'class', 'jar'])
const ARCHIVE_EXTS = new Set(['zip', 'gz', 'tar', 'rar', '7z', 'dmg', 'iso', 'jar'])
const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'php', 'swift', 'sh', 'bash', 'zsh', 'sql', 'json', 'yml', 'yaml', 'toml', 'html', 'css', 'scss'])

export function fileExtension(name: string): string {
    return name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
}

export function filePreviewKind(name: string): FilePreviewKind {
    const ext = fileExtension(name)
    if (IMAGE_EXTS.has(ext)) return 'image'
    if (ext === 'pdf') return 'pdf'
    if (AUDIO_EXTS.has(ext)) return 'audio'
    if (VIDEO_EXTS.has(ext)) return 'video'
    if (BINARY_EXTS.has(ext)) return 'binary'
    return 'text'
}

export function isArchive(name: string): boolean {
    return ARCHIVE_EXTS.has(fileExtension(name))
}

export function isCode(name: string): boolean {
    return CODE_EXTS.has(fileExtension(name))
}

export const THUMB_IMAGE_MAX_BYTES = 3_000_000
export const THUMB_TEXT_MAX_BYTES = 262_144

export function fileTypeIcon(name: string): LucideIcon | null {
    switch (filePreviewKind(name)) {
        case 'audio':
            return AudioWaveformIcon
        case 'video':
            return FilmIcon
        case 'binary':
            return isArchive(name) ? ArchiveIcon : BinaryIcon
        case 'text':
            return isCode(name) ? Code2 : null
        default:
            return null
    }
}
