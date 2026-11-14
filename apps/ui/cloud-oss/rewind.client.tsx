'use client'

import { create } from 'zustand'

type RewindState = { weeks: { viewed: boolean }[]; shown: unknown; openLatest: () => void }

export const useRewindStore = create<RewindState>(() => ({ weeks: [], shown: null, openLatest: () => {} }))

export const selectHasUnseenLatest = (_state: RewindState) => false

export function useRewindLauncher(_workspaceId: number | undefined, _ready: boolean, _deepLinked: boolean) {}

export function RewindViewer() {
    return null
}
