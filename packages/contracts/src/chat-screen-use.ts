import { parseHitlReply } from './chat-hitl.js'
import { toolNameOf } from './chat-tool-name.js'
import { messageText } from './message-text.js'

const SCREEN_TOOLS = new Set(['computer', 'computer_open_app'])
const NAVIGATE_TOOL = 'browser_navigate'

type ToolPart = { type: string; toolName?: string; input?: unknown; text?: string }
type MessageLike = { role: string; parts: readonly { type: string }[] }

// The run the thread is in: everything since the person last wrote. Answering a block the run asked
// (a takeover handed back, a question) resumes that same run, so it does not start a new one.
export function currentRunMessages<M extends MessageLike>(messages: readonly M[]): readonly M[] {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && !parseHitlReply(messageText(messages[i]))) return messages.slice(i + 1)
    }
    return messages
}

const runParts = (messages: readonly MessageLike[]) => currentRunMessages(messages).flatMap(message => message.parts as readonly ToolPart[])

export function runUsesScreen(messages: readonly MessageLike[]): boolean {
    return runParts(messages).some(part => SCREEN_TOOLS.has(toolNameOf(part)))
}

// Read by hand: React Native's `URL` has no `hostname`. Userinfo and port are set aside, so
// `https://stripe.com@evil.example/` names `evil.example` and nothing else.
const URL_HOST = /^[a-z][a-z\d+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i

export function siteOf(url: string): string | null {
    const host = url.match(URL_HOST)?.[1]
    return host ? host.toLowerCase().replace(/^www\./, '') : null
}

// The site the screen is on, as far as the thread can tell: the one a takeover asks for, otherwise the
// last page the run opened in its browser.
export function screenSite(messages: readonly MessageLike[], takeoverUrl: string | null): string | null {
    if (takeoverUrl) return siteOf(takeoverUrl)
    const navigation = runParts(messages).findLast(part => toolNameOf(part) === NAVIGATE_TOOL)
    const url = (navigation?.input as { url?: unknown } | undefined)?.url
    return typeof url === 'string' ? siteOf(url) : null
}
