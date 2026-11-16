import { describe, expect, it } from 'vitest'
import {
    ROOM_DEFAULT_MINUTES,
    ROOM_MAX_MEMBERS,
    ROOM_MAX_MINUTES,
    ROOM_MAX_ROUNDS,
    roomCloseInputSchema,
    roomDetailSchema,
    roomOpenInputSchema,
    roomPostInputSchema,
    roomSummarySchema,
} from '@rerun/contracts'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `agent-${i}`)
const openBase = { title: 'T', question: 'Q', members: ['a', 'b'] }
const at = '2026-11-16T13:00:00Z'
const member = (i: number) => ({ agentId: `a${i}`, name: `Name ${i}`, tokensIn: 1, tokensOut: 2 })
const post = (seq: number, round: number, kind: 'post' | 'decision' = 'post') => ({
    id: `p${seq}`,
    seq,
    round,
    kind,
    authorKind: 'coworker' as const,
    authorId: 'a0',
    authorName: 'Name 0',
    text: 'hello',
    createdAt: at,
})
const detail = () => ({
    id: 'r1',
    title: 'T',
    job: null,
    openedBy: 'rob',
    status: 'decided',
    round: 2,
    members: [member(0), member(1), member(2)],
    lastPost: { authorName: 'Name 0', text: 'done' },
    createdAt: at,
    closesAt: at,
    closedAt: at,
    question: 'Q',
    decision: 'Go',
    posts: [post(1, 1), post(2, 1), post(3, 1), post(4, 2), post(5, 2), post(6, 2), post(7, 0, 'decision')],
})

describe('room contract', () => {
    it('accepts a room open with 2 to 5 members and refuses 1 and 6', () => {
        expect(ROOM_MAX_MEMBERS).toBe(5)
        expect(roomOpenInputSchema.safeParse(openBase).success).toBe(true)
        expect(roomOpenInputSchema.safeParse({ ...openBase, members: ids(5) }).success).toBe(true)
        expect(roomOpenInputSchema.safeParse({ ...openBase, members: ids(1) }).success).toBe(false)
        expect(roomOpenInputSchema.safeParse({ ...openBase, members: ids(6) }).success).toBe(false)
    })

    it('refuses one past each open limit', () => {
        const ok = (patch: object) => roomOpenInputSchema.safeParse({ ...openBase, ...patch }).success
        expect(ok({ title: 'x'.repeat(120) })).toBe(true)
        expect(ok({ title: 'x'.repeat(121) })).toBe(false)
        expect(ok({ question: 'x'.repeat(8000) })).toBe(true)
        expect(ok({ question: 'x'.repeat(8001) })).toBe(false)
        expect(ok({ members: ['x'.repeat(64), 'b'] })).toBe(true)
        expect(ok({ members: ['x'.repeat(65), 'b'] })).toBe(false)
        expect(ok({ job: 'x'.repeat(80) })).toBe(true)
        expect(ok({ job: 'x'.repeat(81) })).toBe(false)
        expect(ok({ minutes: 60 })).toBe(true)
        expect(ok({ minutes: 61 })).toBe(false)
        expect(ok({ minutes: 0 })).toBe(false)
        expect(ROOM_MAX_MINUTES).toBe(60)
        expect(ROOM_DEFAULT_MINUTES).toBe(30)
    })

    it('accepts a closed room detail with a decision post and refuses an unknown status', () => {
        expect(ROOM_MAX_ROUNDS).toBe(2)
        expect(roomDetailSchema.safeParse(detail()).success).toBe(true)
        expect(roomDetailSchema.safeParse({ ...detail(), status: 'closed' }).success).toBe(false)
        const bad = { ...detail(), posts: [post(1, 3)] }
        expect(roomDetailSchema.safeParse(bad).success).toBe(false)
    })

    it('refuses an unknown key at every level', () => {
        const author = { id: 'a', name: 'A' }
        expect(roomOpenInputSchema.safeParse({ ...openBase, extra: 1 }).success).toBe(false)
        expect(roomPostInputSchema.safeParse({ text: 't', author }).success).toBe(true)
        expect(roomPostInputSchema.safeParse({ text: 't', author: { ...author, extra: 1 } }).success).toBe(false)
        expect(roomCloseInputSchema.safeParse({ decision: 'd', outcome: 'decided', extra: 1 }).success).toBe(false)
        const d = detail()
        const { question, decision, posts, ...summary } = d
        expect(roomSummarySchema.safeParse(summary).success).toBe(true)
        expect(roomSummarySchema.safeParse({ ...summary, members: [{ ...member(0), extra: 1 }, member(1)] }).success).toBe(false)
        expect(roomDetailSchema.safeParse({ ...d, posts: [{ ...post(1, 1), extra: 1 }] }).success).toBe(false)
        expect(roomSummarySchema.safeParse({ ...summary, lastPost: { authorName: 'A', text: 't', extra: 1 } }).success).toBe(false)
    })

    it('takes only decided or presented as a close outcome', () => {
        expect(roomCloseInputSchema.safeParse({ decision: 'd', outcome: 'decided' }).success).toBe(true)
        expect(roomCloseInputSchema.safeParse({ decision: 'd', outcome: 'presented' }).success).toBe(true)
        expect(roomCloseInputSchema.safeParse({ decision: 'd', outcome: 'expired' }).success).toBe(false)
    })
})
