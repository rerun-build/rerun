import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-skills-c2-'))
process.env.RERUN_API_KEY = ''

const built = vi.hoisted(() => [] as { inputSchema?: unknown }[])
vi.mock('ai', async importOriginal => {
    const original = await importOriginal<typeof import('ai')>()
    return {
        ...original,
        tool: ((def: { inputSchema?: unknown }) => {
            built.push(def)
            return (original.tool as (d: unknown) => unknown)(def)
        }) as typeof original.tool,
    }
})

const { beforeAll, describe, expect, it } = await import('vitest')
const { mkdir, readFile, writeFile } = await import('node:fs/promises')
const { z } = await import('zod')
const { migrate } = await import('../../db/migrate.js')
const { createAgent } = await import('../../agents/factory.js')
const { loadAgentFromDisk } = await import('../../agents/loader.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeSkill, writeSkillFile } = await import('../../skills/loader.js')
const { setSkillEnabled } = await import('../../skills/switch.js')
const { buildSkillIndex } = await import('../../skills/index.js')
const { skillTools } = await import('./skills.js')
const { skillProposeTool } = await import('./skill-propose.js')
const { selfTools } = await import('./self.js')
const { agentToolCatalog } = await import('../catalog.js')
const { configPath, skillDir, workspaceDir } = await import('../../config/paths.js')

let id = ''
const skillFile = (slug: string) => resolve(skillDir(id, slug), 'SKILL.md')
const NOT_FOUND = (slug: string) => `Skill not found: ${slug}`

async function loadedCtx() {
    return { agent: await loadAgentFromDisk(id), sessionId: 's', provider: 'openrouter', model: 'm' } as any
}
async function call(tools: any, name: string, args: Record<string, unknown>): Promise<string> {
    return (await tools[name].execute(args, {} as any)) as string
}

beforeAll(async () => {
    await migrate()
    id = (await createAgent({ config: { name: 'switch-c2' } })).id
    await writeSkill(id, 'Alpha', 'the on skill', 'alpha body')
    await writeSkill(id, 'Beta', 'the off skill', 'beta body')
    await writeSkillFile(id, 'beta', 'references/more.md', 'beta reference')
    await setSkillEnabled(id, 'beta', false)
})

describe('a switched-off skill in a run', () => {
    it('is left out of the index', async () => {
        const { agent } = await loadedCtx()
        const index = await buildSkillIndex(agent.id, agent.config)
        expect(index).toContain('alpha')
        expect(index).not.toContain('beta')
    })

    it('is hidden and untouchable through the skill tools', async () => {
        const tools = skillTools(await loadedCtx())
        const list = await call(tools, 'skill_list', {})
        expect(list).toContain('alpha')
        expect(list).not.toContain('beta')

        const before = await readFile(skillFile('beta'), 'utf8')
        const attempts: [string, Record<string, unknown>][] = [
            ['skill_read', { slug: 'beta' }],
            ['skill_read_file', { slug: 'beta', path: 'references/more.md' }],
            ['skill_write_file', { slug: 'beta', path: 'references/x.md', content: 'x' }],
            ['skill_delete_file', { slug: 'beta', path: 'references/more.md' }],
            ['skill_update', { slug: 'beta', description: 'd', body: 'new' }],
            ['skill_edit', { slug: 'beta', oldString: 'beta body', newString: 'changed' }],
            ['skill_delete', { slug: 'beta' }],
        ]
        for (const [name, args] of attempts) expect(await call(tools, name, args), name).toBe(NOT_FOUND('beta'))

        const refusal = 'A skill with this name exists and cannot be changed from here.'
        expect(await call(tools, 'skill_create', { name: 'Beta', description: 'd', body: 'new' })).toBe(refusal)
        await mkdir(workspaceDir(id), { recursive: true })
        await writeFile(resolve(workspaceDir(id), 'beta.md'), 'imported body', 'utf8')
        expect(await call(tools, 'skill_import', { sourcePath: 'beta.md' })).toBe(refusal)
        expect(await readFile(skillFile('beta'), 'utf8')).toBe(before)
    })

    it('cannot be the target of an edit proposal', async () => {
        const tools = skillProposeTool(await loadedCtx())
        const out = await call(tools, 'skill_propose', { mode: 'edit', slug: 'beta', title: 'Change beta', summary: 's', instruction: 'Always do it differently.' })
        expect(out).toBe('No skill with slug "beta". Nothing shown.')
    })

    it('has no tool anywhere that takes the switch, and verbosity_set leaves it alone', async () => {
        built.length = 0
        agentToolCatalog(agentConfigSchema.parse({ name: 'all-on' }))
        expect(built.length).toBeGreaterThan(20)
        const names = new Set<string>()
        const walk = (node: any): void => {
            if (!node || typeof node !== 'object') return
            for (const [key, value] of Object.entries<any>(node.properties ?? {})) {
                names.add(key)
                walk(value)
            }
            walk(node.items)
            for (const part of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) walk(part)
        }
        for (const def of built) {
            const schema = def.inputSchema as any
            if (!schema || typeof schema !== 'object') continue
            try {
                walk(z.toJSONSchema(schema))
            } catch {
                walk(schema.jsonSchema)
            }
        }
        expect(names.size).toBeGreaterThan(20)
        expect([...names].filter(n => /disabled.?skills?|skill.?(enabled|switch)|enable.?skill/i.test(n))).toEqual([])

        const before = JSON.parse(await readFile(configPath(id), 'utf8')).disabledSkills
        expect(before).toEqual(['beta'])
        const ctx = await loadedCtx()
        ctx.agent.config = agentConfigSchema.parse({ ...ctx.agent.config, selfImprovement: { enabled: true } })
        await call(selfTools(ctx), 'verbosity_set', { level: 'minimal', reason: 'The user asked for shorter answers.' })
        expect(JSON.parse(await readFile(configPath(id), 'utf8')).disabledSkills).toEqual(before)
    })

    it('reads as before once switched back on', async () => {
        await setSkillEnabled(id, 'beta', true)
        const ctx = await loadedCtx()
        const out = await call(skillTools(ctx), 'skill_read', { slug: 'beta' })
        expect(out).toContain('beta body')
        expect(out).toContain('references/more.md')
        expect(await call(skillTools(ctx), 'skill_read_file', { slug: 'beta', path: 'references/more.md' })).toBe('beta reference')
        expect(await buildSkillIndex(ctx.agent.id, ctx.agent.config)).toContain('beta')
    })
})
