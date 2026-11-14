import { describe, expect, it } from 'vitest'
import { AGENT_SHARE_INCLUDE_NONE, agentShareIncludeSchema, resolveShareInclude, shareContents, shareExcludePaths, type AgentArchivePlan } from '@rerun/contracts'

function entry(path: string, over: Partial<AgentArchivePlan['files'][number]> = {}): AgentArchivePlan['files'][number] {
    return { path, bytes: 100, flagged: [], defaultExcluded: false, note: '', ...over }
}

const PLAN = {
    files: [
        entry('SOUL.md'),
        entry('config.json'),
        entry('.env'),
        entry('skills/writer/SKILL.md'),
        entry('schedules/weekly.md'),
        entry('triggers/inbound.md'),
        entry('memory/a1.md', { defaultExcluded: true, note: 'memory' }),
        entry('memory/a2.md', { defaultExcluded: true, note: 'memory' }),
        entry('data/agent.db', { bytes: 4096, note: 'agent database' }),
        entry('workspace/report.md'),
        entry('workspace/.rerun/services.json'),
        entry('workspace/.env.backup', { flagged: ['sensitive path'], defaultExcluded: true }),
    ],
} as unknown as AgentArchivePlan

const ALL_OFF = { memories: false, database: false, files: false }
const ALL_ON = { memories: true, database: true, files: true }

describe('shareExcludePaths', () => {
    it('keeps only what makes the agent an agent when everything is off', () => {
        expect(shareExcludePaths(PLAN, ALL_OFF).sort()).toEqual(
            ['data/agent.db', 'memory/a1.md', 'memory/a2.md', 'workspace/.env.backup', 'workspace/report.md'].sort(),
        )
    })

    it('lets a flagged file through no switch at all', () => {
        for (const include of [ALL_OFF, ALL_ON, { ...ALL_ON, files: true }]) {
            expect(shareExcludePaths(PLAN, include)).toContain('workspace/.env.backup')
        }
    })

    it('always ships the connector registry, or the copy lands blind to what it needs', () => {
        expect(shareExcludePaths(PLAN, ALL_OFF)).not.toContain('workspace/.rerun/services.json')
        expect(shareExcludePaths(PLAN, ALL_ON)).not.toContain('workspace/.rerun/services.json')
    })

    it('excludes nothing but the flagged file when everything is on', () => {
        expect(shareExcludePaths(PLAN, ALL_ON)).toEqual(['workspace/.env.backup'])
    })

    it('opens one bucket at a time', () => {
        expect(shareExcludePaths(PLAN, { ...ALL_OFF, memories: true })).not.toContain('memory/a1.md')
        expect(shareExcludePaths(PLAN, { ...ALL_OFF, memories: true })).toContain('data/agent.db')

        expect(shareExcludePaths(PLAN, { ...ALL_OFF, database: true })).not.toContain('data/agent.db')
        expect(shareExcludePaths(PLAN, { ...ALL_OFF, database: true })).toContain('memory/a1.md')

        expect(shareExcludePaths(PLAN, { ...ALL_OFF, files: true })).not.toContain('workspace/report.md')
        expect(shareExcludePaths(PLAN, { ...ALL_OFF, files: true })).toContain('memory/a1.md')
    })

    it('never excludes the files that define the agent itself', () => {
        const excluded = shareExcludePaths(PLAN, ALL_OFF)
        for (const path of ['SOUL.md', 'config.json', '.env', 'skills/writer/SKILL.md', 'schedules/weekly.md', 'triggers/inbound.md']) {
            expect(excluded).not.toContain(path)
        }
    })
})

describe('shareContents', () => {
    it('prices each switch without counting what will never travel', () => {
        expect(shareContents(PLAN)).toEqual({
            memories: { count: 2, bytes: 200 },
            database: { count: 1, bytes: 4096 },
            files: { count: 1, bytes: 100 },
        })
    })
})

describe('resolveShareInclude', () => {
    it('sends nothing when nothing is named', () => {
        expect(resolveShareInclude(undefined)).toEqual(AGENT_SHARE_INCLUDE_NONE)
        expect(resolveShareInclude({})).toEqual(AGENT_SHARE_INCLUDE_NONE)
        expect(resolveShareInclude(null)).toEqual(AGENT_SHARE_INCLUDE_NONE)
    })

    it('does not inherit the schema defaults, which would ship the workspace folder', () => {
        expect(agentShareIncludeSchema.parse({}).files).toBe(true)
        expect(resolveShareInclude({})).not.toEqual(agentShareIncludeSchema.parse({}))
    })

    it('opens exactly the buckets it was given', () => {
        expect(resolveShareInclude({ memories: true })).toEqual({ memories: true, database: false, files: false })
        expect(resolveShareInclude({ memories: true, database: true, files: true })).toEqual(ALL_ON)
    })

    it('ignores anything that is not a boolean true', () => {
        expect(resolveShareInclude({ files: 'yes', database: 1, memories: true, secrets: true })).toEqual({ memories: true, database: false, files: false })
    })
})
