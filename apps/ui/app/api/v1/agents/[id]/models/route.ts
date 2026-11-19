import { readAgentModels } from '@/app/api/_services/agent-model.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { agentModelsForClient } from '@/app/api/v1/_lib/legacy-client'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.getAgentModels, { auth: 'member' }, async ({ req, ctx, params }) => agentModelsForClient(req, await readAgentModels(ctx, params.id)))
