export { MAX_RECORDING_MS } from '@moldwright/contracts'

export const RECORDING_BITS_PER_SECOND = 32_000

export type RecordingFormat = {
    mimeType: string
    extension: string
    transcriptionFormat: string
}

const CANDIDATES: readonly RecordingFormat[] = [
    { mimeType: 'audio/mp4;codecs=mp4a.40.2', extension: 'm4a', transcriptionFormat: 'm4a' },
    { mimeType: 'audio/webm;codecs=opus', extension: 'webm', transcriptionFormat: 'webm' },
    { mimeType: 'audio/webm', extension: 'webm', transcriptionFormat: 'webm' },
    { mimeType: 'audio/mp4', extension: 'm4a', transcriptionFormat: 'm4a' },
    { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg', transcriptionFormat: 'ogg' },
]

export const TRANSCRIPTION_FORMATS = new Set(CANDIDATES.map(c => c.transcriptionFormat))

const BROKEN_FORMATS_KEY = 'rerun:voice:broken-formats'

function readBrokenFormats(): string[] {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(BROKEN_FORMATS_KEY) ?? '[]')
        return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
    } catch {
        return []
    }
}

export function markRecordingFormatBroken(mimeType: string) {
    try {
        const broken = readBrokenFormats()
        if (!broken.includes(mimeType)) localStorage.setItem(BROKEN_FORMATS_KEY, JSON.stringify([...broken, mimeType]))
    } catch {}
}

function defaultIsTypeSupported(mimeType: string): boolean {
    return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType) && !readBrokenFormats().includes(mimeType)
}

export function pickRecordingFormat(isTypeSupported: (mimeType: string) => boolean = defaultIsTypeSupported): RecordingFormat | null {
    return CANDIDATES.find(candidate => isTypeSupported(candidate.mimeType)) ?? null
}

export function pickBackupFormat(primary: RecordingFormat, isTypeSupported: (mimeType: string) => boolean = defaultIsTypeSupported): RecordingFormat | null {
    const after = CANDIDATES.slice(CANDIDATES.findIndex(candidate => candidate.mimeType === primary.mimeType) + 1)
    return after.find(candidate => isTypeSupported(candidate.mimeType)) ?? null
}
