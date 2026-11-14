export type ConversationPage = { key: string; sessionId: string | null; general?: boolean }

export const GENERAL_PAGE_ID = 'general'
export const GENERAL_DRAFT_KEY = 'general:new'

export function conversationPages(openIds: string[], bornKeys: Record<string, string>, draftKey: string, general?: { sessionId: string | null }): ConversationPage[] {
    const threads = general?.sessionId ? openIds.filter(id => id !== general.sessionId) : openIds
    const lead: ConversationPage[] = general ? [{ key: general.sessionId ? (bornKeys[general.sessionId] ?? general.sessionId) : GENERAL_DRAFT_KEY, sessionId: general.sessionId, general: true }] : []
    return [...lead, ...threads.map(id => ({ key: bornKeys[id] ?? id, sessionId: id })), { key: draftKey, sessionId: null }]
}

export function activePageIndex(pages: ConversationPage[], activeId: string | null): number {
    const index = activeId === GENERAL_PAGE_ID ? pages.findIndex(page => page.general) : activeId ? pages.findIndex(page => page.sessionId === activeId) : -1
    return index >= 0 ? index : pages.length - 1
}
