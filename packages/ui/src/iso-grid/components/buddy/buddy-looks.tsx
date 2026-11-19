'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { BuddyLook } from '../../types'

const NO_LOOK: BuddyLook = {}
const NO_LOOKS: ReadonlyMap<string, BuddyLook> = new Map()

const BuddyLooks = createContext(NO_LOOKS)

// The looks the app's coworkers were given, by agent id, so every buddy drawn away from the board
// wears the one its coworker chose. An id missing from it keeps the look hashed from the id.
export function BuddyLooksProvider({ looks, children }: { looks: ReadonlyMap<string, BuddyLook>; children: ReactNode }) {
    return <BuddyLooks.Provider value={looks}>{children}</BuddyLooks.Provider>
}

export function useBuddyLookOf(agentId: string): BuddyLook {
    return useContext(BuddyLooks).get(agentId) ?? NO_LOOK
}
