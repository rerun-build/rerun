import { describe, expect, it } from 'vitest'

import { buildWorkspaceScene, MAX_SCENE_BOXES } from './workspace-scene'

const SEEDS = Array.from({ length: 60 }, (_, i) => `seed-${i}`)

const AGENT_SPAN = 2

describe('buildWorkspaceScene', () => {
    it('is deterministic', () => {
        expect(buildWorkspaceScene('abc')).toEqual(buildWorkspaceScene('abc'))
    })

    it('keeps every agent inside its own Box', () => {
        for (const seed of SEEDS) {
            const scene = buildWorkspaceScene(seed)
            for (const agent of scene.agents) {
                const space = scene.spaces.find(s => s.id === agent.spaceId)
                expect(space).toBeDefined()
                expect(agent.position.col).toBeGreaterThanOrEqual(space!.col_start)
                expect(agent.position.row).toBeGreaterThanOrEqual(space!.row_start)
                expect(agent.position.col + AGENT_SPAN - 1).toBeLessThanOrEqual(space!.col_end)
                expect(agent.position.row + AGENT_SPAN - 1).toBeLessThanOrEqual(space!.row_end)
            }
        }
    })

    it('never puts two agents on the same cell', () => {
        for (const seed of SEEDS) {
            const scene = buildWorkspaceScene(seed)
            const keys = scene.agents.map(a => `${a.position.col},${a.position.row}`)
            expect(new Set(keys).size).toBe(keys.length)
        }
    })

    it('always shows something running, and links only existing agents', () => {
        for (const seed of SEEDS) {
            const scene = buildWorkspaceScene(seed)
            expect(scene.agents.some(a => a.status === 'working')).toBe(true)
            const ids = new Set(scene.agents.map(a => a.id))
            for (const link of scene.links) {
                expect(ids.has(link.source)).toBe(true)
                expect(ids.has(link.target)).toBe(true)
                expect(link.source).not.toBe(link.target)
            }
        }
    })

    it('never shows a broken or switched off agent', () => {
        for (const seed of SEEDS) {
            for (const agent of buildWorkspaceScene(seed).agents) {
                expect(['idle', 'working', 'waiting_human']).toContain(agent.status)
                expect(agent.disabledAt).toBeNull()
            }
        }
    })

    it('draws odd 16:9-ish frames', () => {
        const widths = new Set<number>()
        for (const seed of SEEDS) {
            const { width, height } = buildWorkspaceScene(seed)
            expect(width % 8).not.toBe(0)
            expect(Math.abs(width / height - 16 / 9)).toBeLessThan(0.06)
            widths.add(width)
        }
        expect(widths.size).toBeGreaterThan(SEEDS.length / 3)
    })

    it('honours the overrides', () => {
        const scene = buildWorkspaceScene('fixed', { boxes: MAX_SCENE_BOXES, agentsPerBox: 3, theme: 'light' })
        expect(scene.spaces).toHaveLength(MAX_SCENE_BOXES)
        expect(scene.agents).toHaveLength(MAX_SCENE_BOXES * 3)
        expect(scene.theme).toBe('light')
    })

    it('frames the whole scene inside the picture', () => {
        for (const seed of SEEDS) {
            const scene = buildWorkspaceScene(seed)
            expect(scene.camera.zoom).toBeGreaterThan(0.3)
            expect(Number.isFinite(scene.camera.pan.x)).toBe(true)
            expect(Number.isFinite(scene.camera.pan.y)).toBe(true)
        }
    })
})
