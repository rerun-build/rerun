import { attachmentDisplayName, parseAttachments } from './chat-attachments.js'
import { stripVoiceMarker } from './voice.js'

export const MESSAGE_PREVIEW_MAX = 200

// How much of a message is read to write its preview. The patterns below backtrack on long runs of
// whitespace, and a message has no size limit: bounded here, the preview costs the same whatever was sent.
const PREVIEW_SOURCE_MAX = 2000

const ELLIPSIS = '…'

// Markdown read as plain text: what a person would see once rendered, on one line. A pattern anchored
// on a line matches blanks as `[ \t]`, never `\s`: that one runs across the line breaks, and a run of
// empty lines is then read again from each of them.
function plainText(markdown: string): string {
    return (
        markdown
            // Fenced code keeps its content, without the fences and the language.
            .replace(/```[^\n]*\n?/g, '')
            .replace(/<[^>\n]+>/g, ' ')
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/^\s{0,3}#{1,6}\s+/gm, '')
            .replace(/^\s{0,3}>\s?/gm, '')
            .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
            // A table's separator row, then its pipes.
            .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '')
            .replace(/[ \t]*\|[ \t]*/g, ' ')
            // Emphasis hugs its words: `2 * 3 * 4` is arithmetic, not italics.
            .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, '$2')
            .replace(/(^|[\s(])[*_](\S(?:[^*_\n]*\S)?)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
            .replace(/`([^`]*)`/g, '$1')
            .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
            .replace(/\s+/g, ' ')
            .trim()
    )
}

function clip(text: string): string {
    if (text.length <= MESSAGE_PREVIEW_MAX) return text
    const cut = text.slice(0, MESSAGE_PREVIEW_MAX - 1)
    const space = cut.lastIndexOf(' ')
    return `${(space > MESSAGE_PREVIEW_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}${ELLIPSIS}`
}

/**
 * A message as one readable line, for the list of coworkers: markdown, links and tables read as text,
 * a voice message as its transcript, files sent on their own as their names. Empty when nothing is
 * left to show, which leaves the previous line in place.
 */
export function messagePreview(text: string): string {
    const withoutVoice = stripVoiceMarker(text)
    const attached = parseAttachments(withoutVoice)
    const source = stripVoiceMarker(attached ? attached.text : withoutVoice)
    const body = plainText(source.slice(0, PREVIEW_SOURCE_MAX))
    if (body) return clip(body)
    return attached ? clip(attached.paths.map(attachmentDisplayName).join(', ')) : ''
}
