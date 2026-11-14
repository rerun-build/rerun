import { loadAgentFromDisk } from '../agents/loader.js'
import { modelFor } from '../agents/providers.js'
import { runExactRead } from './exact-read.js'

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}

const agentId = arg('agent')
if (!agentId) {
    console.error('usage: exact-read-cli.ts --agent <agentId> [--seed <n>]')
    process.exit(2)
}
const seed = arg('seed') === undefined ? 1 : Number(arg('seed'))
if (!Number.isInteger(seed)) {
    console.error('--seed must be an integer')
    process.exit(2)
}
const agent = await loadAgentFromDisk(agentId)
const { provider, model } = agent.resolved
const r = await runExactRead({ provider, model, languageModel: modelFor(agent) }, seed)
console.log(`EXACT-READ ${r.provider}/${r.model} ${r.score}/20 seed ${r.seed}`)
process.exit(0)
