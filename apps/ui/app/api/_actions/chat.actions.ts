'use server'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { startKickoff, type KickoffResult } from '@/app/api/_services/kickoff.service'
import { messageAuthorOf } from '@/app/api/_services/me.service'

export async function startKickoffAction(agentId: string, input: { kickoff?: string; description?: string }): Promise<KickoffResult> {
    return startKickoff(agentId, input, await messageAuthorOf(await requireWorkspaceContext()))
}
