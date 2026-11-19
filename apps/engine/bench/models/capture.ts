import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { asSchema } from 'ai'

const outDir = resolve(import.meta.dirname, '../../../../.context/bench')
process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-model-bench-'))
process.env.RERUN_API_KEY = 'bench'
process.env.RERUN_LOG_LEVEL = 'fatal'

const { agentConfigSchema } = await import('@moldwright/contracts')
const { buildSystemPrompt } = await import('../../src/agents/systemPrompt.js')
const { buildTools } = await import('../../src/tools/registry.js')
const { logger } = await import('../../src/lib/logger.js')
type LoadedAgent = import('../../src/agents/types.js').LoadedAgent

async function capture(label: string, soul: string, install: string, setupRequired: boolean) {
    const config = agentConfigSchema.parse({ name: 'Scout', setup: setupRequired ? { required: true } : undefined })
    const agent = { id: `bench-${label}`, config, soul, install, env: {}, resolved: { provider: 'openrouter', model: 'bench', connection: null } } as unknown as LoadedAgent
    const system = await buildSystemPrompt(agent, { source: 'chat' }, 'openrouter')
    const { tools } = await buildTools({ agent, sessionId: 's', logger, provider: 'openrouter', model: 'bench', callTargets: [] } as never)
    const defs = await Promise.all(
        Object.entries(tools).map(async ([name, t]) => {
            const tool = t as { description?: string; inputSchema: unknown }
            return { type: 'function', function: { name, description: tool.description ?? '', parameters: await asSchema(tool.inputSchema as never).jsonSchema } }
        }),
    )
    writeFileSync(resolve(outDir, `fixture-${label}.json`), JSON.stringify({ system, tools: defs, installText: install }, null, 1))
    console.log(label, 'system chars', system.length, 'tools', defs.length, 'tools chars', JSON.stringify(defs).length)
    console.log(defs.map(d => d.function.name).join(' '))
}

await capture('plain', 'You are Scout, a competitive intelligence analyst for a small company. You track competitors, their pricing and their product moves, and you report what changed in plain words. You are precise with numbers: you never round a price or guess one, and you always say where a figure comes from.', '', false)
await capture('setup', 'You are Scout, a competitive intelligence analyst for a small company. You track competitors, their pricing and their product moves, and you report what changed in plain words. You are precise with numbers: you never round a price or guess one, and you always say where a figure comes from.', '# Scout setup\n\n1. Ask the user, in ONE ask_user call: their company name and website, the competitors to watch (up to 3), the language reports should be written in, and their timezone.\n2. Write `config/profile.json` with exactly these keys: `company`, `website`, `competitors` (array of names), `language`, `timezone`.\n3. Create a table `competitors` with columns `name`, `website`, `pricing_from_usd`, `notes`, insert one row per competitor (leave what you do not know empty), and save a view of it named "Competitors".\n4. Create a scheduled task named "Weekly competitor watch" that runs every Monday at 08:00 in the user\'s timezone.\n5. Remember the report language as a preference with memory_write.\n6. Read `config/profile.json` back to verify it, then call install_complete.\n\nFrom then on, write to the user in their report language.', true)
process.exit(0)
