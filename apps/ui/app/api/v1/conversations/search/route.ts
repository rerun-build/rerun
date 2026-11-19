import { searchWorkspaceConversations } from '@/app/api/_services/conversation.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The conversations of the workspace found by their title, as the web's control center finds them.
export const GET = apiRoute(mobileApi.searchConversations, { auth: 'member' }, async ({ ctx, query }) => searchWorkspaceConversations(ctx, query.q, query.agentId))
