export type BubbleFrame = 'bubble' | 'bare' | 'media'
export type MessageBubble = { markdown: string; frame: BubbleFrame }

type BlockKind = 'heading' | 'lead-in' | 'bare' | 'media' | 'rule' | 'text'

const IMAGES_ONLY = /^(!\[[^\]\n]*\]\([^)\n]*\)\s*)+$/

const TABLE_DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function kindOf(block: string): BlockKind {
    const head = block.replace(/^\n+/, '')
    const firstLine = head.split('\n', 1)[0]
    if (/^ {0,3}#{1,6}\s/.test(firstLine)) return 'heading'
    if (/^ {0,3}(```|~~~|\$\$)/.test(firstLine) || /^( {4}|\t)/.test(firstLine)) return 'bare'
    const secondLine = head.split('\n')[1]
    if (firstLine.includes('|') && secondLine !== undefined && TABLE_DELIMITER_ROW.test(secondLine)) return 'bare'
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(head.trimEnd())) return 'rule'
    if (IMAGES_ONLY.test(head.trim())) return 'media'
    if (/:\s*$/.test(head) && !/^ {0,3}([-*+]|\d+[.)])\s/.test(firstLine)) return 'lead-in'
    return 'text'
}

export function bubblesOfBlocks(blocks: string[]): MessageBubble[] {
    const bubbles: { blocks: string[]; frame: BubbleFrame; announces: boolean }[] = []
    for (const block of blocks) {
        if (!block.trim()) continue
        const kind = kindOf(block)
        const last = bubbles.at(-1)
        if (kind === 'rule') {
            if (last) last.announces = false
            continue
        }
        const announces = kind === 'heading' || kind === 'lead-in'
        const frame: BubbleFrame = kind === 'bare' || kind === 'media' ? kind : 'bubble'
        if (frame === 'bubble' && last?.frame === 'bubble' && last.announces) {
            last.blocks.push(block)
            last.announces = announces
            continue
        }
        bubbles.push({ blocks: [block], frame, announces })
    }
    return bubbles.map(bubble => ({ markdown: bubble.blocks.map(block => block.replace(/^\n+/, '').trimEnd()).join('\n\n'), frame: bubble.frame }))
}
