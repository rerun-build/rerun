import { describe, expect, it } from 'vitest'

import { colorFromId, cursorFromPayload, leavingUserId, MAX_CURSORS, placeCursor, type TimedCursor } from './team-cursor'

const members = new Map([
    ['alice', { id: 'alice', name: 'Alice', photo: 'https://cdn.example/alice.png' }],
    ['bob', { id: 'bob', name: 'Bob' }],
])
const memberOf = (id: string) => members.get(id) ?? null

describe('cursorFromPayload', () => {
    it('shows the name and photo the member list holds, never those of the payload', () => {
        const cursor = cursorFromPayload({ userId: 'alice', name: 'CEO', avatarUrl: 'https://evil.example/x.png', color: 'red', x: 1, y: 2 }, memberOf)
        expect(cursor).toEqual({ userId: 'alice', name: 'Alice', avatarUrl: 'https://cdn.example/alice.png', color: colorFromId('alice'), x: 1, y: 2 })
        expect(cursorFromPayload({ userId: 'bob', x: 0, y: 0 }, memberOf)?.avatarUrl).toBeNull()
    })

    it('ignores an id the member list does not know', () => {
        expect(cursorFromPayload({ userId: 'mallory', x: 1, y: 1 }, memberOf)).toBeNull()
        expect(cursorFromPayload({ userId: '', x: 1, y: 1 }, memberOf)).toBeNull()
        expect(cursorFromPayload({ userId: 42, x: 1, y: 1 }, memberOf)).toBeNull()
    })

    it('ignores a position that is not a pair of finite numbers', () => {
        expect(cursorFromPayload({ userId: 'alice', x: Number.NaN, y: 1 }, memberOf)).toBeNull()
        expect(cursorFromPayload({ userId: 'alice', x: 1, y: Number.POSITIVE_INFINITY }, memberOf)).toBeNull()
        expect(cursorFromPayload({ userId: 'alice', x: '1', y: 1 }, memberOf)).toBeNull()
        expect(cursorFromPayload({ userId: 'alice', x: 1 }, memberOf)).toBeNull()
    })

    it('ignores a payload that is not an object', () => {
        expect(cursorFromPayload(null, memberOf)).toBeNull()
        expect(cursorFromPayload('alice', memberOf)).toBeNull()
        expect(cursorFromPayload(undefined, memberOf)).toBeNull()
    })
})

describe('leavingUserId', () => {
    it('reads a non-empty string id and nothing else', () => {
        expect(leavingUserId({ userId: 'alice' })).toBe('alice')
        expect(leavingUserId({ userId: '' })).toBeNull()
        expect(leavingUserId({ userId: 1 })).toBeNull()
        expect(leavingUserId(null)).toBeNull()
    })
})

describe('placeCursor', () => {
    const cursorOf = (userId: string) => ({ userId, name: userId, avatarUrl: null, color: colorFromId(userId), x: 0, y: 0 })

    it('keeps at most MAX_CURSORS people and lets the ones already there keep moving', () => {
        const cursors = new Map<string, TimedCursor>()
        for (let i = 0; i < MAX_CURSORS; i++) expect(placeCursor(cursors, cursorOf(`member-${i}`), i)).toBe(true)
        expect(placeCursor(cursors, cursorOf('one-too-many'), 99)).toBe(false)
        expect(cursors.size).toBe(MAX_CURSORS)
        expect(placeCursor(cursors, { ...cursorOf('member-0'), x: 7, y: 8 }, 100)).toBe(true)
        expect(cursors.get('member-0')).toMatchObject({ x: 7, y: 8, ts: 100 })
    })
})
