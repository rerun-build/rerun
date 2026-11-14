import { readFile } from 'node:fs/promises'
import { configPath } from '../config/paths.js'
import { withAgentLock } from './lock.js'
import { writeAgentConfig } from './config-write.js'
import { getAgent, reloadAgent } from './registry.js'
import { agentConfigSchema, type LoadedAgent } from './types.js'
import { nowIso } from '../lib/ids.js'
import { getSession } from '../db/repos/sessions.js'
import type { SessionRow } from '../db/schema.js'

export function hasPendingSetup(agent: LoadedAgent): boolean {
    return agent.config.setup.required === true && agent.config.setup.completedAt === null && agent.install.trim().length > 0
}

export async function markSetupComplete(id: string): Promise<string> {
    return withAgentLock(id, async () => {
        const current = agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
        const completedAt = nowIso()
        await writeAgentConfig(id, { ...current, setup: { ...current.setup, completedAt } })
        await reloadAgent(id)
        return completedAt
    })
}

export type InstallClaim = { session: SessionRow } | { inFlight: string }

export async function claimInstallSession(id: string, create: () => Promise<SessionRow>): Promise<InstallClaim> {
    return withAgentLock(id, async () => {
        const agent = await getAgent(id)
        const claimed = agent.config.setup.sessionId
        if (hasPendingSetup(agent) && claimed && (await getSession(id, claimed))) return { inFlight: claimed }

        const session = await create()
        if (!hasPendingSetup(agent)) return { session }
        const current = agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8')))
        await writeAgentConfig(id, { ...current, setup: { ...current.setup, sessionId: session.id } })
        await reloadAgent(id)
        return { session }
    })
}
