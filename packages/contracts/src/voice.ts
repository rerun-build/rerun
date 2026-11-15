export const PEAK_COUNT = 48

export const MAX_RECORDING_MS = 5 * 60 * 1000

const MAX_LEVEL = 35

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0
    return value < 0 ? 0 : value > 1 ? 1 : value
}

export function encodePeaks(levels: readonly number[]): string {
    if (levels.length === 0) return ''
    let encoded = ''
    for (let i = 0; i < PEAK_COUNT; i++) {
        const start = Math.floor((i * levels.length) / PEAK_COUNT)
        const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / PEAK_COUNT))
        let sum = 0
        let count = 0
        for (let j = start; j < end && j < levels.length; j++) {
            sum += clamp01(levels[j])
            count++
        }
        encoded += Math.round((count > 0 ? sum / count : 0) * MAX_LEVEL).toString(36)
    }
    return encoded
}

export function decodePeaks(encoded: string): number[] {
    const peaks: number[] = []
    for (const char of encoded) {
        const value = Number.parseInt(char, 36)
        peaks.push(Number.isNaN(value) ? 0 : clamp01(value / MAX_LEVEL))
    }
    return peaks
}

export type VoiceMessage = {
    transcript: string
    src: string
    durationMs: number
    peaks: number[]
}

const BLOCK = /\n*<voice ((?:[^>"]|"[^"]*")*)>\s*$/
const ATTRIBUTE = /([\w-]+)="([^"]*)"/g

function escapeAttribute(value: string): string {
    return value.replaceAll('"', '&quot;')
}

export function buildVoiceMarker({ src, durationMs, levels }: { src: string; durationMs: number; levels: readonly number[] }): string {
    return `<voice src="${escapeAttribute(src)}" ms="${Math.max(0, Math.round(durationMs))}" peaks="${encodePeaks(levels)}">`
}

export function appendVoiceMarker(transcript: string, marker: string): string {
    const trimmed = transcript.trim()
    return trimmed ? `${trimmed}\n\n${marker}` : marker
}

export function stripVoiceMarker(text: string): string {
    return text.replace(BLOCK, '').trim()
}

export function parseVoiceMessage(text: string): VoiceMessage | null {
    const match = BLOCK.exec(text)
    if (!match) return null

    const attributes = new Map<string, string>()
    for (const [, name, value] of match[1].matchAll(ATTRIBUTE)) {
        attributes.set(name, value.replaceAll('&quot;', '"'))
    }

    const src = attributes.get('src')
    if (!src) return null

    return {
        transcript: text.slice(0, match.index).trim(),
        src,
        durationMs: Number(attributes.get('ms') ?? 0) || 0,
        peaks: decodePeaks(attributes.get('peaks') ?? ''),
    }
}

export type TranscriptWord = {
    text: string
    start: number
}

export function transcriptWords(transcript: string): TranscriptWord[] {
    const length = transcript.length
    let offset = 0
    return transcript
        .split(/(\s+)/)
        .filter(piece => piece.length > 0)
        .map(piece => {
            const word = { text: piece, start: length > 0 ? offset / length : 0 }
            offset += piece.length
            return word
        })
}
