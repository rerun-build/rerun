import type { EngineConnection } from '@/lib/engine/types'

// What `engine_pool` says of a machine is asked for by every call to an engine and by every call an
// engine makes back, and it changes a handful of times in a machine's life. So it is kept for a
// moment, in this process only. A row changed by another process (the pool restarting a box, a
// release) is seen once the entry runs out; an absence is never kept, so a machine claimed a
// second ago is found at once.
const ENGINE_MEMORY_MS = 30_000
const MAX_ENTRIES = 5_000

type Kept<V> = { value: V; until: number }

function keep<K, V>(entries: Map<K, Kept<V>>, key: K, value: V): void {
    if (entries.size >= MAX_ENTRIES) entries.clear()
    entries.set(key, { value, until: Date.now() + ENGINE_MEMORY_MS })
}

function kept<K, V>(entries: Map<K, Kept<V>>, key: K): V | undefined {
    const entry = entries.get(key)
    if (!entry) return undefined
    if (entry.until > Date.now()) return entry.value
    entries.delete(key)
    return undefined
}

type MachineOf = { conn: EngineConnection }
type WorkspaceOf = { workspaceId: number }

const machines = new Map<number, Kept<MachineOf>>()
const tokenWorkspaces = new Map<string, Kept<WorkspaceOf>>()

export function keptMachine<M extends MachineOf>(workspaceId: number): M | undefined {
    return kept(machines, workspaceId) as M | undefined
}

export function keepMachine(workspaceId: number, machine: MachineOf): void {
    keep(machines, workspaceId, machine)
}

export function keptTokenWorkspace<W extends WorkspaceOf>(token: string): W | undefined {
    return kept(tokenWorkspaces, token) as W | undefined
}

export function keepTokenWorkspace(token: string, workspace: WorkspaceOf): void {
    keep(tokenWorkspaces, token, workspace)
}

export function forgetMachine(workspaceId: number): void {
    machines.delete(workspaceId)
    for (const [token, entry] of tokenWorkspaces) if (entry.value.workspaceId === workspaceId) tokenWorkspaces.delete(token)
}

// A machine that does not answer may have moved: the next call reads where it is now.
export function forgetMachineAt(url: string): void {
    for (const [workspaceId, entry] of machines) if (url.startsWith(entry.value.conn.baseUrl)) forgetMachine(workspaceId)
}
