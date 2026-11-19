import { bubblesOfBlocks, type MessageBubble } from '@moldwright/contracts'
import { parseMarkdownIntoBlocks } from 'streamdown'

export type { BubbleFrame, MessageBubble } from '@moldwright/contracts'

export function splitIntoBubbles(markdown: string): MessageBubble[] {
    return bubblesOfBlocks(parseMarkdownIntoBlocks(markdown))
}
