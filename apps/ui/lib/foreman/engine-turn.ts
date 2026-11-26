import 'server-only'

import { actorFromContext, callableEngineAgentIds } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { AgentChatTarget } from '@/app/api/_services/chat.service'
import type { ChatParams } from '@/lib/chat/start-chat'
import { supportsForemanVault } from '@/lib/engine/client'
import { foremanEngineBrief } from './engine-brief'
import { mintForemanHubToken } from './hub-token'
import type { ForemanState } from './phase'

type ForemanTurnChoice = Pick<ChatParams, 'connectionId' | 'model' | 'effort' | 'source'> & { greeting?: boolean }

// What the engine is handed with every message to the Chief of Staff, whoever sends it: the
// instructions and the tools of where the workspace stands now, with a token that carries this
// member's rights.
export async function foremanTurnParams(ctx: WorkspaceContext, state: ForemanState, target: AgentChatTarget, { greeting = false, ...choice }: ForemanTurnChoice): Promise<Omit<ChatParams, 'sessionId' | 'message' | 'author'>> {
    return {
        ...choice,
        foreman: { ...foremanEngineBrief(state, { greeting, vault: await supportsForemanVault(target.conn) }), hubToken: mintForemanHubToken(ctx.workspace.id, ctx.userId) ?? undefined },
        callableAgentIds: await callableEngineAgentIds(actorFromContext(ctx)),
    }
}
