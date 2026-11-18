import { type ToolSet } from 'ai'
import { makeFsTools } from './fsTools.js'
import { sharedDir } from '../../config/paths.js'
import { agentSpaceId } from '../../brain/boxes.js'
import { recordFileCreated } from '../../brain/files.js'
import { logger } from '../../lib/logger.js'
import type { RunContext } from '../../runtime/context.js'

// A file a coworker writes into the shared folder is filed in the Brain as its own, under its Box.
// The write already landed, so a filing that fails is logged rather than reported as a failed call.
export function sharedTools(ctx: RunContext): ToolSet {
    const onWrite = (path: string) =>
        agentSpaceId(ctx.agent.id)
            .then(spaceId => recordFileCreated(path, `agent:${ctx.agent.config.name}`, spaceId))
            .catch(err => logger.warn({ err, path }, 'shared file not filed in the brain'))
    return makeFsTools({ prefix: 'shared', label: 'shared space every coworker can read and write', rootDir: sharedDir(), onWrite })
}
