import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { RecalledMemory } from '../memory/store.js'
import { curationSchema, curatorPrompt } from './curator.js'

describe('curationSchema', () => {
    it('requires every property for strict structured output', () => {
        const schema = z.toJSONSchema(curationSchema) as { properties?: Record<string, unknown>; required?: string[] }
        expect(schema.required).toEqual(Object.keys(schema.properties ?? {}))
        expect(schema.required).toContain('obsoleteIds')
    })

    it('accepts an explicit empty obsolete id list', () => {
        expect(curationSchema.parse({ memory: null, obsoleteIds: [] })).toEqual({ memory: null, obsoleteIds: [] })
    })

    it('can only emit memory operations', () => {
        expect(Object.keys(curationSchema.shape)).toEqual(['memory', 'obsoleteIds'])
    })
})

// Capture is the user's call, through skill_propose and the row they accept in the chat. An edit
// reaching for a writer here would break at the import line rather than in production.
describe('the curator never writes a skill', () => {
    it('imports nothing from the skill loader and the Brain but their summaries', () => {
        const source = readFileSync(new URL('./curator.ts', import.meta.url), 'utf8')
        expect(source).not.toMatch(/writeSkill|writeSkillFolder|writeSkillFile|deleteSkill|applySkillProposal|skill_(create|update|edit|propose)/)
        expect(source).toMatch(/import type \{ SkillSummary \} from '\.\.\/skills\/loader\.js'/)
        expect(source).toMatch(/import \{ listUsableSkillSummaries \} from '\.\.\/skills\/brain\.js'/)
    })
})

const exchange = { userText: 'Cale-toi sur ce post pour la longueur', assistantText: 'Compris.' }

describe('curatorPrompt', () => {
    it('routes how-to knowledge to a skill and forbids folding it into a memory', () => {
        const prompt = curatorPrompt({ ...exchange, existing: [], skills: [] })
        expect(prompt).toContain('Anything that says how the work is done belongs in a skill, not in memory')
        expect(prompt).toContain('never fold it into an existing memory through updateId')
        expect(prompt).toContain('Memory is the fallback for what no skill governs')
    })

    it('lists the skills that already govern the work', () => {
        const prompt = curatorPrompt({ ...exchange, existing: [], skills: [{ slug: 'write-like-clement', name: 'Write like Clement', description: 'His voice' }] })
        expect(prompt).toContain('These skills already govern how this coworker works')
        expect(prompt).toContain('- Write like Clement (slug: write-like-clement): His voice')
    })

    it('says nothing about skills when the agent has none', () => {
        const prompt = curatorPrompt({ ...exchange, existing: [], skills: [] })
        expect(prompt).not.toContain('These skills already govern')
    })

    it('still offers the existing memories for an in-place update', () => {
        const existing: RecalledMemory[] = [{ id: 'mem-1', content: 'Il poste le samedi', kind: 'learned', tags: [], createdAt: '2026-09-15T00:00:00Z', strength: 1 }]
        const prompt = curatorPrompt({ ...exchange, existing, skills: [] })
        expect(prompt).toContain('- [mem-1] (learned) Il poste le samedi')
    })
})
