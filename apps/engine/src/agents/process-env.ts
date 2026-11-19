import { mkdirSync } from 'node:fs'
import { agentDataDbPath, agentDataDir, sharedDbDir, sharedDbPath, workspaceDir } from '../config/paths.js'
import type { LoadedAgent } from './types.js'
import { readSharedEnvSync } from './shared-env.js'

export type AgentProcessEnv = { cwd: string; env: Record<string, string> }

const GIT_HELPER_KEY = 'credential.https://github.com.helper'
const GIT_HELPER = '!f() { if [ "$1" = get ]; then echo username=x-access-token; echo "password=$GH_TOKEN"; fi; }; f'

export function githubCredentialEnv(env: Record<string, string>): Record<string, string> {
    if (!env.GH_TOKEN || env.GIT_CONFIG_COUNT !== undefined) return env
    return { ...env, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: GIT_HELPER_KEY, GIT_CONFIG_VALUE_0: '', GIT_CONFIG_KEY_1: GIT_HELPER_KEY, GIT_CONFIG_VALUE_1: GIT_HELPER }
}

export function sharedProcessEnv(): Record<string, string> {
    return githubCredentialEnv(readSharedEnvSync())
}

export function agentProcessEnv(agent: Pick<LoadedAgent, 'id' | 'env' | 'config'>, labels?: Record<string, string>): AgentProcessEnv {
    const cwd = workspaceDir(agent.id)
    mkdirSync(cwd, { recursive: true })
    mkdirSync(agentDataDir(agent.id), { recursive: true })
    const env: Record<string, string> = { ...readSharedEnvSync(), ...agent.env, ...labels, RERUN_AGENT_DB: agentDataDbPath(agent.id), RERUN_WORKSPACE: cwd }
    if (agent.config.tools.sharedDb) {
        mkdirSync(sharedDbDir(), { recursive: true })
        env.RERUN_SHARED_DB = sharedDbPath()
    }
    return { cwd, env: githubCredentialEnv(env) }
}
