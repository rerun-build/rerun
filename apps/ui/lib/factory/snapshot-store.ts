import 'server-only'

import type { FactorySnapshot } from '@rerun/contracts'

export type HeldSnapshot = { snapshot: FactorySnapshot; receivedAt: number }

const store = globalThis as typeof globalThis & { __rerunFactorySnapshots?: Map<number, HeldSnapshot> }
const held = (store.__rerunFactorySnapshots ??= new Map<number, HeldSnapshot>())

export function putFactorySnapshot(workspaceId: number, snapshot: FactorySnapshot, receivedAt = Date.now()): boolean {
    const current = held.get(workspaceId)
    if (current && Date.parse(current.snapshot.madeAt) > Date.parse(snapshot.madeAt)) return false
    held.set(workspaceId, { snapshot, receivedAt })
    return true
}

export function getFactorySnapshot(workspaceId: number): HeldSnapshot | null {
    return held.get(workspaceId) ?? null
}
