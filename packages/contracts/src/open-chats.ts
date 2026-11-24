import { z } from 'zod'

// The threads a person left open on a coworker, the same on all their devices. General is never one of
// them: it is always there, and stands as null wherever a conversation is named.

// Past this many the oldest are closed, and reopened from the coworker's threads list.
export const MAX_OPEN_CHATS = 8

const MAX_CHANGES = 100

// How many times an answer that crossed a change made here is asked for again.
const MAX_RELOADS = 3

// Signed out, too many requests, too slow: the same changes may pass later.
const PASSING_STATUSES = new Set([401, 408, 429])

// The hub answered and will never take what it was sent.
export function isRefusedStatus(status: number): boolean {
    return status >= 400 && status < 500 && !PASSING_STATUSES.has(status)
}

export const deviceKindSchema = z.enum(['computer', 'phone'])
export type DeviceKind = z.infer<typeof deviceKindSchema>

export const chatDeviceSchema = z.object({ id: z.guid(), kind: deviceKindSchema })
export type ChatDevice = z.infer<typeof chatDeviceSchema>

export const openChatSchema = z.object({ id: z.string(), title: z.string().nullable() })
export type OpenChat = z.infer<typeof openChatSchema>

// `last`: the conversation picked last, and the device it was picked on. Null until a first one is.
export const openChatsSchema = z.object({
    chats: z.array(openChatSchema),
    last: z.object({ activeId: z.string().nullable(), deviceId: z.string(), deviceKind: deviceKindSchema, changedAt: z.string() }).nullable(),
})
export type OpenChats = z.infer<typeof openChatsSchema>

// Selecting a thread opens it. One change at a time, never the whole list: a device left behind would
// write its old list back, and open again what was closed elsewhere.
export const openChatChangeSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('select'), sessionId: z.guid().nullable() }), z.object({ type: z.literal('close'), sessionId: z.guid() })])
export type OpenChatChange = z.infer<typeof openChatChangeSchema>

// `merge`: what the device held before its first sync, added to what the person has open.
export const changeOpenChatsSchema = z.object({
    device: chatDeviceSchema,
    changes: z.array(openChatChangeSchema).max(MAX_CHANGES).default([]),
    merge: z.array(z.guid()).max(MAX_CHANGES).optional(),
})
export type ChangeOpenChats = z.infer<typeof changeOpenChatsSchema>
export type ChangeOpenChatsInput = z.input<typeof changeOpenChatsSchema>

// The thread next to the one closed takes its place, the last one when it was last, General (null) with none left.
export function afterClosing(openIds: string[], closedId: string): string | null {
    const rest = openIds.filter(id => id !== closedId)
    return rest[Math.min(Math.max(openIds.indexOf(closedId), 0), rest.length - 1)] ?? null
}

export type ResumeChat = { sessionId: string; title: string | null; deviceKind: DeviceKind; changedAt: string }

// `opening`: the coworker was just opened. `returning`: it was on screen already, and its window is
// back in front. `opened-on`: opened on that very conversation (a notification, the inbox, the search).
export type ArrivalKind = 'opening' | 'returning' | 'opened-on'

// `activeId` is undefined on a draft nobody has written in yet, which no other device knows.
export type Arrival = { openIds: string[]; activeId: string | null | undefined; resume: ResumeChat | null }

// What a device shows once the hub has answered. A conversation picked on another device is offered
// from General, never opened by itself; picked here, nothing moves.
export function arrive(server: OpenChats, here: { deviceId: string; activeId: string | null | undefined; dismissedAt: string | null }, kind: ArrivalKind): Arrival {
    const { last } = server
    const openIds = server.chats.map(chat => chat.id)
    const closedElsewhere = typeof here.activeId === 'string' && !openIds.includes(here.activeId)
    const elsewhere = last !== null && last.deviceId !== here.deviceId && last.changedAt !== here.dismissedAt && last.activeId !== here.activeId ? last : null
    const offered = elsewhere && kind !== 'opened-on' ? server.chats.find(chat => chat.id === elsewhere.activeId) : undefined
    const resume = elsewhere && offered ? { sessionId: offered.id, title: offered.title, deviceKind: elsewhere.deviceKind, changedAt: elsewhere.changedAt } : null
    if (kind === 'opening' && (closedElsewhere || elsewhere)) return { openIds, activeId: null, resume }
    // Closed elsewhere while on screen here: it stays until the person leaves it.
    return { openIds: closedElsewhere ? [...openIds, here.activeId as string] : openIds, activeId: here.activeId, resume }
}

// What a device keeps beside its list: the changes the hub has not taken yet, whether its own list
// was merged once, and the offer it was told to drop.
export type OpenChatsMemo = { pending: OpenChatChange[]; merged: boolean; dismissedAt: string | null }

export const EMPTY_OPEN_CHATS_MEMO: OpenChatsMemo = { pending: [], merged: false, dismissedAt: null }

const memoSchema = z.object({ pending: z.array(openChatChangeSchema), merged: z.boolean(), dismissedAt: z.string().nullable() })

export function parseOpenChatsMemo(raw: string | null | undefined): OpenChatsMemo {
    try {
        return memoSchema.catch(EMPTY_OPEN_CHATS_MEMO).parse(raw ? JSON.parse(raw) : null)
    } catch {
        return EMPTY_OPEN_CHATS_MEMO
    }
}

export type LocalChats = { openIds: string[]; activeId: string | null | undefined }

export type OpenChatsSyncOptions = {
    device: ChatDevice
    memo: { read: () => OpenChatsMemo; write: (memo: OpenChatsMemo) => void }
    read: () => Promise<OpenChats>
    change: (body: ChangeOpenChatsInput) => Promise<OpenChats>
    // The hub answered and will never take these changes: they are dropped rather than sent again.
    refused?: (error: unknown) => boolean
    delayMs?: number
}

// The way between a device and the hub. Changes leave together, a moment after the last one; one the
// network lost stays in the memo and leaves before the next read, even in a later launch.
export class OpenChatsSync {
    private timer: ReturnType<typeof setTimeout> | null = null
    private sending: Promise<OpenChats | null> = Promise.resolve(null)
    private recorded = 0

    constructor(private readonly options: OpenChatsSyncOptions) {}

    get dismissedAt(): string | null {
        return this.options.memo.read().dismissedAt
    }

    record(...changes: OpenChatChange[]) {
        if (changes.length === 0) return
        this.recorded++
        const memo = this.options.memo.read()
        this.options.memo.write({ ...memo, pending: [...memo.pending, ...changes].slice(-MAX_CHANGES) })
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.flush(), this.options.delayMs ?? 400)
    }

    dismiss(changedAt: string) {
        this.options.memo.write({ ...this.options.memo.read(), dismissedAt: changedAt })
    }

    // Sends what waits. Never rejects: what could not leave is kept.
    flush(): Promise<OpenChats | null> {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        return this.queue(() => (this.options.memo.read().pending.length > 0 ? this.send() : Promise.resolve(null)))
    }

    // What the person has open, `local` merged into it the first time. Null when the hub could not be
    // reached, `changed` when something changed here meanwhile: the answer would undo it.
    async load(local: LocalChats): Promise<OpenChats | 'changed' | null> {
        const before = this.recorded
        const answer = await this.queue(async () => {
            const memo = this.options.memo.read()
            if (!memo.merged) return this.merge(local)
            return memo.pending.length > 0 ? this.send() : this.options.read()
        })
        return before === this.recorded ? answer : 'changed'
    }

    // As `load`, asked again while something changes here: `changedHere` says it did.
    async settle(local: () => LocalChats): Promise<{ server: OpenChats; changedHere: boolean } | null> {
        for (let reloads = 0; reloads <= MAX_RELOADS; reloads++) {
            const server = await this.load(local())
            if (server !== 'changed') return server && { server, changedHere: reloads > 0 }
        }
        return null
    }

    private queue(task: () => Promise<OpenChats | null>): Promise<OpenChats | null> {
        this.sending = this.sending.then(task).catch(() => null)
        return this.sending
    }

    private async merge(local: LocalChats): Promise<OpenChats> {
        const answer = await this.send(local.openIds)
        this.options.memo.write({ ...this.options.memo.read(), merged: true })
        if (answer.last !== null || !local.activeId) return answer
        return this.options.change({ device: this.options.device, changes: [{ type: 'select', sessionId: local.activeId }] })
    }

    private async send(merge?: string[]): Promise<OpenChats> {
        const { pending } = this.options.memo.read()
        try {
            const answer = await this.options.change({ device: this.options.device, changes: pending, ...(merge && { merge }) })
            this.forget(pending)
            return answer
        } catch (error) {
            if (this.options.refused?.(error)) this.forget(pending)
            throw error
        }
    }

    // Another window of the same browser may have added to the memo, or sent it, meanwhile.
    private forget(sent: OpenChatChange[]) {
        const memo = this.options.memo.read()
        const stillFirst = JSON.stringify(memo.pending.slice(0, sent.length)) === JSON.stringify(sent)
        if (stillFirst) this.options.memo.write({ ...memo, pending: memo.pending.slice(sent.length) })
    }
}
