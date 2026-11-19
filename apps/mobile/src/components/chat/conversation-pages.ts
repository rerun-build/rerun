// A page of the coworker's pager: an open conversation, or the draft that ends the row. `general` marks
// the coworker's General, pinned first.
export type ConversationPage = { key: string; sessionId: string | null; general?: boolean }

// Stands for the General in the route and the active id until its first message gives it a session.
export const GENERAL_PAGE_ID = 'general'
export const GENERAL_DRAFT_KEY = 'general:new'

// A coworker opens on its General. Its session, when the Home already knows it, rides along so the
// page mounts on it at once rather than as an empty draft that the list later replaces.
export function generalHref(agentId: string, generalSessionId: string | null | undefined) {
    return { pathname: '/chat/[id]' as const, params: { id: GENERAL_PAGE_ID, to: agentId, ...(generalSessionId ? { general: generalSessionId } : {}) } }
}

// The open conversations in the header's order, then the draft a swipe past the last one lands on.
// A conversation born from a draft keeps that page's key, so its chat is not mounted again. With
// `general`, the coworker's General leads the row, keyed by its id so a conversation opened before
// the list said it was General keeps its chat when it moves to the front.
export function conversationPages(openIds: string[], bornKeys: Record<string, string>, draftKey: string, general?: { sessionId: string | null }): ConversationPage[] {
    const threads = general?.sessionId ? openIds.filter(id => id !== general.sessionId) : openIds
    const lead: ConversationPage[] = general ? [{ key: general.sessionId ? (bornKeys[general.sessionId] ?? general.sessionId) : GENERAL_DRAFT_KEY, sessionId: general.sessionId, general: true }] : []
    return [...lead, ...threads.map(id => ({ key: bornKeys[id] ?? id, sessionId: id })), { key: draftKey, sessionId: null }]
}

export function activePageIndex(pages: ConversationPage[], activeId: string | null): number {
    const index = activeId === GENERAL_PAGE_ID ? pages.findIndex(page => page.general) : activeId ? pages.findIndex(page => page.sessionId === activeId) : -1
    return index >= 0 ? index : pages.length - 1
}
