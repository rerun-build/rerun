import { actorFromContext } from '@/app/api/_auth/access'
import { changeOpenChats, readOpenChats } from '@/app/api/_services/open-chats.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.getOpenChats, { auth: 'member' }, ({ ctx, params }) => readOpenChats(params.id, actorFromContext(ctx)))

export const POST = apiRoute(mobileApi.changeOpenChats, { auth: 'member' }, ({ ctx, params, body }) => changeOpenChats(params.id, body, actorFromContext(ctx)))
