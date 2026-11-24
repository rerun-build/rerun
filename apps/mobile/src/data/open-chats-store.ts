import { EMPTY_OPEN_CHATS_MEMO, parseOpenChatsMemo, type ChatDevice, type OpenChatsMemo } from '@rerun/contracts'
import { randomUUID } from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'

// The person's open chats of one coworker, as the phone holds them: `openIds` to draw the first frame,
// `memo` what it still owes the hub.
export type StoredOpenChats = { openIds: string[]; memo: OpenChatsMemo }

// Files, not SecureStore: a value there is capped at 2 KB, and a day offline may owe more than that.
const folder = () => new Directory(Paths.document, 'open-chats')
const fileOf = (key: string) => new File(folder(), `${key.replace(/[^\w-]/g, '_')}.json`)

const DEVICE_KEY = 'rerun.chat-device'

// What the app kept before the hub did, of whoever was signed in: merged once.
const legacyKey = (agentId: string) => `rerun.open-chats.${agentId.replace(/[^\w.-]/g, '_')}`

function stringsOf(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

function legacyOpenIds(agentId: string): string[] {
    try {
        const raw = SecureStore.getItem(legacyKey(agentId))
        return raw ? stringsOf(JSON.parse(raw)) : []
    } catch {
        return []
    }
}

export function readOpenChats(key: string, agentId: string): StoredOpenChats {
    try {
        const file = fileOf(key)
        if (file.exists) {
            const stored = JSON.parse(file.textSync()) as { openIds?: unknown; memo?: unknown }
            return { openIds: stringsOf(stored.openIds), memo: parseOpenChatsMemo(JSON.stringify(stored.memo)) }
        }
    } catch {}
    return { openIds: legacyOpenIds(agentId), memo: EMPTY_OPEN_CHATS_MEMO }
}

export function writeOpenChats(key: string, value: StoredOpenChats) {
    try {
        folder().create({ intermediates: true, idempotent: true })
        fileOf(key).write(JSON.stringify(value))
    } catch {}
}

let device: ChatDevice | null = null

export function chatDevice(): ChatDevice {
    if (device) return device
    let id: string | null = null
    try {
        id = SecureStore.getItem(DEVICE_KEY)
    } catch {}
    if (!id) {
        id = randomUUID()
        SecureStore.setItemAsync(DEVICE_KEY, id).catch(() => {})
    }
    device = { id, kind: 'phone' }
    return device
}
