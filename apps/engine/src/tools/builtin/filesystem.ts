import { delimiter, isAbsolute, resolve } from 'node:path'
import { type ToolSet } from 'ai'
import { makeFsTools } from './fsTools.js'
import { workspaceDir } from '../../config/paths.js'
import { env } from '../../config/env.js'
import type { AgentConfig } from '../../agents/types.js'
import type { RunContext } from '../../runtime/context.js'

export function fsExtraRoots(config: AgentConfig): string[] {
    if (!config.tools.shell) return []
    return (env().RERUN_FS_EXTRA_ROOTS ?? '').split(delimiter).filter(root => isAbsolute(root)).map(root => resolve(root))
}

export function filesystemTools(ctx: RunContext): ToolSet {
    return makeFsTools({ prefix: 'fs', label: 'coworker workspace', rootDir: workspaceDir(ctx.agent.id), extraRoots: fsExtraRoots(ctx.agent.config) })
}
