import { listMemberProfiles } from '@/app/api/_services/members.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.listMembers, { auth: 'member' }, async ({ ctx }) => listMemberProfiles(ctx))
