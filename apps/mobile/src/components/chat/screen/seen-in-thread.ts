const SEEN_RATIO = 0.4

type Span = { top: number; bottom: number }

export function seenInThread(block: Span, visible: Span): boolean {
    const height = block.bottom - block.top
    if (height <= 0) return true
    const shown = Math.min(visible.bottom, block.bottom) - Math.max(visible.top, block.top)
    return shown / height >= SEEN_RATIO
}
