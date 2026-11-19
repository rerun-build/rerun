import { createContext, useContext, type ReactNode } from 'react'

import type { BuddyLook } from './look'

const NO_LOOK: BuddyLook = {}
const NO_LOOKS: ReadonlyMap<string, BuddyLook> = new Map()

const BuddyLooks = createContext(NO_LOOKS)

// The looks the coworkers were given, by agent id. An id missing from it keeps the look hashed from
// the id, as on the board.
export function BuddyLooksProvider({ looks, children }: { looks: ReadonlyMap<string, BuddyLook>; children: ReactNode }) {
    return <BuddyLooks.Provider value={looks}>{children}</BuddyLooks.Provider>
}

export function useBuddyLookOf(agentId: string): BuddyLook {
    return useContext(BuddyLooks).get(agentId) ?? NO_LOOK
}
