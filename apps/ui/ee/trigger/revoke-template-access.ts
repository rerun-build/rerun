import { logger, task } from '@trigger.dev/sdk/v3'
import { pauseTemplateAgentSchedules } from '@/ee/services/template-revocation.service'

export type RevokeTemplateAccessPayload = { workspaceId: number; templateId: string }

export const revokeTemplateAccessTask = task({
    id: 'revoke-template-access',
    maxDuration: 300,
    retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 60000 },
    run: async ({ workspaceId, templateId }: RevokeTemplateAccessPayload) => {
        logger.log('template revocation starting', { workspaceId, templateId })
        await pauseTemplateAgentSchedules(workspaceId, templateId)
        logger.log('template revocation done', { workspaceId, templateId })
        return { workspaceId, templateId }
    },
})

export async function requestTemplateRevocation(payload: RevokeTemplateAccessPayload): Promise<void> {
    try {
        await revokeTemplateAccessTask.trigger(payload)
    } catch (err) {
        console.error('Failed to schedule a template revocation', err)
    }
}
