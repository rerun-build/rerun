import { describe, expect, it } from 'vitest'

import { containerFromSpace, tileFromAgent } from './iso-adapter'
import { type IsoAgent, UNNAMED_BOX_LABEL } from './types'

const space = { id: 's1', workspace_id: 1, name: null, col_start: 2, row_start: 2, col_end: 9, row_end: 9, created_at: null }

describe('containerFromSpace', () => {
    // Boxes created before the server named them carry no name, and the tile used to come out with no
    // label at all.
    it('labels a Box that has no name', () => {
        const container = containerFromSpace(space)
        expect(container.label).toBe(UNNAMED_BOX_LABEL)
        expect(container.ariaLabel).toBe(`Box: ${UNNAMED_BOX_LABEL}`)
    })

    it('keeps the name it has', () => {
        const container = containerFromSpace({ ...space, name: 'Acme' })
        expect(container.label).toBe('Acme')
        expect(container.ariaLabel).toBe('Box: Acme')
    })
})

const agent: IsoAgent = { id: 'a1', name: 'Nova', handle: 'nova', description: null, templateId: null, status: 'idle', position: { col: 2, row: 2 }, workspaceId: 1, spaceId: 's1', disabledAt: null, disabledReason: null }
const LOOK = { eyes: 'heart', mouth: 'cat', color: '#00b862' } as const

describe('tileFromAgent, the look of its buddy', () => {
    it('leaves the buddy to its id when nobody dressed the coworker', () => {
        expect(tileFromAgent(agent).style.buddy).toBe(true)
        expect(tileFromAgent({ ...agent, look: null }).style.buddy).toBe(true)
    })

    it('dresses it in the look it was given, and keeps the mood a switched-off one sleeps in', () => {
        expect(tileFromAgent({ ...agent, look: LOOK }).style.buddy).toEqual(LOOK)
        expect(tileFromAgent({ ...agent, look: LOOK, disabledAt: '2026-11-19T10:00:00.000Z' }).style.buddy).toEqual({ ...LOOK, mood: 'asleep' })
    })
})
