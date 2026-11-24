import { isRefusedStatus, OpenChatsSync, parseOpenChatsMemo, type ChangeOpenChatsInput, type ChatDevice, type OpenChats, type OpenChatsMemo } from '@rerun/contracts'

import { detectMobileOs } from '@/lib/in-app-browser'
import { randomUuid } from '@/lib/random-uuid'

const DEVICE_KEY = 'rerun-chat-device'

class OpenChatsError extends Error {
    constructor(readonly status: number) {
        super(`open chats ${status}`)
    }
}

// Without storage (a private window that refuses it) the browser is a new device on each load.
function stored(key: string): string | null {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function store(key: string, value: string) {
    try {
        localStorage.setItem(key, value)
    } catch {}
}

let device: ChatDevice | null = null

export function chatDevice(): ChatDevice {
    if (device) return device
    const known = stored(DEVICE_KEY)
    const id = known ?? randomUuid()
    if (!known) store(DEVICE_KEY, id)
    device = { id, kind: detectMobileOs(navigator.userAgent) ? 'phone' : 'computer' }
    return device
}

async function request(agentId: string, init?: RequestInit): Promise<OpenChats> {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/open-chats`, { cache: 'no-store', ...init })
    if (!res.ok) throw new OpenChatsError(res.status)
    return (await res.json()) as OpenChats
}

const syncs = new Map<string, OpenChatsSync>()

// One per coworker and person: a chat that mounts again goes on with the changes still on their way.
// `storageKey` sets apart the Chief of Staff of each workspace, all reached as the same agent id.
export function openChatsSync(agentId: string, storageKey: string, userId: string): OpenChatsSync {
    const key = `open-chats:${userId}:${storageKey}`
    const existing = syncs.get(key)
    if (existing) return existing
    let memory: OpenChatsMemo | null = null
    const sync = new OpenChatsSync({
        device: chatDevice(),
        memo: {
            read: () => {
                const raw = stored(key)
                return raw ? parseOpenChatsMemo(raw) : (memory ?? parseOpenChatsMemo(null))
            },
            write: memo => {
                memory = memo
                store(key, JSON.stringify(memo))
            },
        },
        read: () => request(agentId),
        // Kept alive: the last change leaves even as the page closes.
        change: (body: ChangeOpenChatsInput) => request(agentId, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }),
        refused: error => error instanceof OpenChatsError && isRefusedStatus(error.status),
    })
    syncs.set(key, sync)
    return sync
}
