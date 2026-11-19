import { STORY_ACTION_MS, STORY_CARD_ENTER_MS, STORY_RESULT_HOLD_MS, type TemplateConnector, type TemplateStoryStep, playableStory, storyStepDurationMs, templateStoryStepSchema } from '@moldwright/contracts'
import { buildTemplateBoard } from '@moldwright/ui/iso-grid'
import { stageStory, storyFrame } from '@moldwright/ui/template-story'
import { describe, expect, it } from 'vitest'

const CONNECTORS: TemplateConnector[] = [
    { slug: 'trendtrack', name: 'TrendTrack', icon: null },
    { slug: 'higgsfield', name: 'Higgsfield', icon: null },
]

const AGENTS = [
    { key: 'remaker', name: 'Ad Remaker', connectorSlugs: ['trendtrack', 'higgsfield'] },
    { key: 'reviewer', name: 'Reviewer', connectorSlugs: [] },
]

function step(overrides: Partial<TemplateStoryStep>): TemplateStoryStep {
    return {
        id: overrides.id ?? 'step',
        caption: 'Caption',
        detail: '',
        agentKey: 'remaker',
        toolSlug: null,
        handoffTo: null,
        status: 'working',
        camera: 'agent',
        artifact: null,
        actions: [],
        ...overrides,
    }
}

const board = buildTemplateBoard(AGENTS, CONNECTORS, new Set())

describe('playableStory', () => {
    it('drops the steps whose agent left the template', () => {
        const story = [step({ id: 'a' }), step({ id: 'b', agentKey: 'gone' }), step({ id: 'c' })]
        expect(playableStory(story, ['remaker']).map(s => s.id)).toEqual(['a', 'c'])
    })

    it('plays nothing under two steps', () => {
        expect(playableStory([step({ id: 'a' }), step({ id: 'b', agentKey: 'gone' })], ['remaker'])).toEqual([])
    })
})

describe('storyStepDurationMs', () => {
    it('gives a step without actions the same hold as a result', () => {
        expect(storyStepDurationMs(step({}))).toBe(STORY_CARD_ENTER_MS + STORY_RESULT_HOLD_MS)
    })

    it('adds one beat per action', () => {
        const actions = ['One', 'Two', 'Three', 'Four', 'Five']
        expect(storyStepDurationMs(step({ actions }))).toBe(STORY_CARD_ENTER_MS + actions.length * STORY_ACTION_MS + STORY_RESULT_HOLD_MS)
    })

    it('drops a duration stored before the story had one pace', () => {
        const stored = { id: 'old', caption: 'Caption', agentKey: 'remaker', durationMs: 9000 }
        expect(templateStoryStepSchema.parse(stored)).not.toHaveProperty('durationMs')
    })

    it('reads a step stored before actions existed as one without any', () => {
        const stored = { id: 'old', caption: 'Caption', agentKey: 'remaker' }
        expect(templateStoryStepSchema.parse(stored).actions).toEqual([])
    })
})

describe('stageStory', () => {
    it('binds a tool to the connector tile of its agent', () => {
        const [staged] = stageStory([step({ toolSlug: 'trendtrack' })], board)
        expect(staged.toolTileId).toBe('remaker::trendtrack')
    })

    it('keeps the step but drops a tool that is not on the board', () => {
        const [staged] = stageStory([step({ toolSlug: 'meta-ads' })], board)
        expect(staged.toolTileId).toBeNull()
    })

    it('ignores a handoff to the agent itself or to a missing agent', () => {
        const staged = stageStory([step({ handoffTo: 'remaker' }), step({ handoffTo: 'gone' }), step({ handoffTo: 'reviewer' })], board)
        expect(staged.map(s => s.handoffTileId)).toEqual([null, null, 'reviewer'])
    })
})

describe('storyFrame', () => {
    it('lays a beam over the cable of the tool being called and keeps the cable', () => {
        const [staged] = stageStory([step({ toolSlug: 'trendtrack' })], board)
        const { links } = storyFrame(staged, board, { entrance: false })
        const pair = links.filter(link => link.source === 'remaker' && link.target === 'remaker::trendtrack')
        expect(pair.map(link => link.variant).sort()).toEqual(['beam', 'cable'])
    })

    it('lights no tool beam while the agent waits for a human', () => {
        const [staged] = stageStory([step({ toolSlug: 'trendtrack', status: 'waiting_human' })], board)
        expect(storyFrame(staged, board, { entrance: false }).links.some(link => link.variant === 'beam')).toBe(false)
    })

    it('dims what a close-up does not involve, and nothing on a wide shot', () => {
        const [close, wide] = stageStory([step({ toolSlug: 'trendtrack' }), step({ camera: 'wide' })], board)
        const dimmed = storyFrame(close, board, { entrance: false })
            .tiles.filter(tile => tile.dimmed)
            .map(tile => tile.id)
        expect(dimmed).toContain('reviewer')
        expect(dimmed).toContain('remaker::higgsfield')
        expect(dimmed).not.toContain('remaker')
        expect(dimmed).not.toContain('remaker::trendtrack')
        expect(storyFrame(wide, board, { entrance: false }).tiles.some(tile => tile.dimmed)).toBe(false)
    })

    it('anchors the artifact on the tool when there is one, on the agent otherwise', () => {
        const artifact = { title: 'Found', line: '', tone: 'neutral' as const }
        const [withTool, withoutTool] = stageStory([step({ id: 'a', toolSlug: 'higgsfield', artifact }), step({ id: 'b', artifact })], board)
        expect(storyFrame(withTool, board, { entrance: false }).artifact?.anchorTileId).toBe('remaker::higgsfield')
        expect(storyFrame(withoutTool, board, { entrance: false }).artifact?.anchorTileId).toBe('remaker')
    })

    it('puts up a card for a step that only has actions', () => {
        const [staged] = stageStory([step({ toolSlug: 'trendtrack', actions: ['Scanning ads'] })], board)
        const { artifact } = storyFrame(staged, board, { entrance: false })
        expect(artifact).toMatchObject({ anchorTileId: 'remaker::trendtrack', actions: ['Scanning ads'], result: null, toolSlug: 'trendtrack' })
    })

    it('frames the tiles of the step on a close-up and the whole board on a wide shot', () => {
        const [close, wide] = stageStory([step({ toolSlug: 'trendtrack', handoffTo: 'reviewer' }), step({ camera: 'wide' })], board)
        expect(storyFrame(close, board, { entrance: false }).focusTileIds.sort()).toEqual(['remaker', 'remaker::trendtrack', 'reviewer'])
        expect(storyFrame(wide, board, { entrance: false }).focusTileIds).toHaveLength(board.tiles.length)
    })
})
