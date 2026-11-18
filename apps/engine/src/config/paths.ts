import { resolve } from 'node:path'
import { env } from './env.js'
import { badRequest } from '../lib/errors.js'

export const dataDir = () => env().RERUN_DATA_DIR

export const isPathSegment = (value: string): boolean => !!value && value !== '.' && value !== '..' && !/[/\\\0]/.test(value)

export function pathSegment(value: string, what: string): string {
    if (!isPathSegment(value)) throw badRequest(`Invalid ${what}: ${JSON.stringify(value)}`)
    return value
}

export const dbPath = () => resolve(dataDir(), 'rerun.db')

export const dataVersionPath = () => resolve(dataDir(), 'data-version.json')

export const lastUpdatePath = () => resolve(dataDir(), 'last-update.json')

export const agentsDir = () => resolve(dataDir(), 'agents')

export const sharedDir = () => resolve(dataDir(), 'shared')

export const sharedDbDir = () => resolve(dataDir(), 'shared-db')

export const sharedDbPath = () => resolve(sharedDbDir(), 'shared.db')

export const brainDir = () => resolve(dataDir(), 'brain')

export const brainPagePath = (slug: string) => resolve(brainDir(), `${pathSegment(slug, 'brain page slug')}.md`)

export const brainDbDir = () => resolve(dataDir(), 'brain-db')

export const brainDbPath = () => resolve(brainDbDir(), 'brain.db')

export const agentDir = (id: string) => resolve(agentsDir(), pathSegment(id, 'agent id'))

export const connectionsDir = () => resolve(dataDir(), 'connections')

export const connectionDir = (id: string) => resolve(connectionsDir(), pathSegment(id, 'connection id'))

export const connectionConfigPath = (id: string) => resolve(connectionDir(id), 'connection.json')

export const connectionEnvPath = (id: string) => resolve(connectionDir(id), '.env')

export const connectionsMigratedPath = () => resolve(connectionsDir(), '.migrated')

export const boxDefaultPath = () => resolve(connectionsDir(), 'default.json')

export const boxPlanPath = () => resolve(dataDir(), 'plan.json')

export const mcpPackagesDir = () => resolve(dataDir(), 'mcp-packages')

export const soulPath = (id: string) => resolve(agentDir(id), 'SOUL.md')

export const configPath = (id: string) => resolve(agentDir(id), 'config.json')

export const installPath = (id: string) => resolve(agentDir(id), 'INSTALL.md')

export const agentEnvPath = (id: string) => resolve(agentDir(id), '.env')

export const workspaceDir = (id: string) => resolve(agentDir(id), 'workspace')

export const agentDataDir = (id: string) => resolve(agentDir(id), 'data')

export const browserProfileDir = (id: string) => resolve(agentDir(id), 'browser-profile')

export const agentDataDbPath = (id: string) => resolve(agentDataDir(id), 'agent.db')

export const systemDbPath = (id: string) => resolve(agentDataDir(id), 'system.db')

export const skillsDir = (id: string) => resolve(agentDir(id), 'skills')

export const skillDir = (id: string, slug: string) => resolve(skillsDir(id), pathSegment(slug, 'skill slug'))

export const schedulesDir = (id: string) => resolve(agentDir(id), 'schedules')

export const scheduleFile = (id: string, slug: string) => resolve(schedulesDir(id), `${pathSegment(slug, 'schedule slug')}.md`)

export const triggersDir = (id: string) => resolve(agentDir(id), 'triggers')

export const triggerFile = (id: string, slug: string) => resolve(triggersDir(id), `${pathSegment(slug, 'trigger slug')}.md`)

export const codexHomeDir = (connectionId: string) => resolve(connectionDir(connectionId), '.codex')

export const codexAuthPath = (connectionId: string) => resolve(codexHomeDir(connectionId), 'auth.json')

export const mcpDir = (id: string) => resolve(agentDir(id), 'mcp')

export const mcpTokenPath = (id: string, name: string) => resolve(mcpDir(id), `${pathSegment(name, 'MCP server name')}.json`)

export const mcpPendingPath = (id: string, name: string) => resolve(mcpDir(id), `${pathSegment(name, 'MCP server name')}.pending.json`)

export const handoverDir = (agentId: string) => resolve(sharedDir(), 'handover', pathSegment(agentId, 'agent id'))
