'use client'

import { createContext, useContext } from 'react'

// The conversation a request card sends from: a coworker's session, or one of the Chief of Staff's.
// Its receipt reopens the card from deep in the thread, where no prop reaches.
export type FeatureRequestConversation = { sessionId: string | null; scope: 'agent' | 'foreman' }

const FeatureRequestConversationContext = createContext<FeatureRequestConversation | null>(null)

export const FeatureRequestConversationProvider = FeatureRequestConversationContext.Provider

export function useFeatureRequestConversation(): FeatureRequestConversation | null {
    return useContext(FeatureRequestConversationContext)
}
