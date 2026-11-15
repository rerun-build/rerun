import { describe, expect, it } from 'vitest'
import { attentionCountByAgent } from './attention'
import type { SessionEntry } from './types'

const session = (id: string, agentId: string, status: SessionEntry['status']): SessionEntry => ({ id, agentId, originAgentId: null, status })

describe('attentionCountByAgent', () => {
    it('counts only what the To handle tab would list', () => {
        const counts = attentionCountByAgent([
            session('a', 'seo_chef', 'awaiting_question'),
            session('b', 'seo_chef', 'error'),
            session('c', 'seo_chef', 'working'),
            session('d', 'writer', 'awaiting_ack'),
        ])
        expect(counts).toEqual({ seo_chef: 2, writer: 1 })
    })

    it('leaves an agent with nothing pending out of the map', () => {
        expect(attentionCountByAgent([session('a', 'scout', 'idle')])).toEqual({})
        expect(attentionCountByAgent([])).toEqual({})
    })
})
