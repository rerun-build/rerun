import { remoteComputerRuleSchema } from '@rerun/contracts'

import { computersOpenTo } from '@/app/api/_services/remote-computer-items.service'
import { addComputerRule } from '@/app/api/_services/remote-computers.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { AppError } from '@/lib/i18n/action-error'

export const dynamic = 'force-dynamic'

// "Always allow" on a computer's card in the iOS app, written before the answer goes out, as on the web.
export const POST = apiRoute({ auth: 'member', body: remoteComputerRuleSchema }, async ({ ctx, params, body }) => {
    if (!computersOpenTo(ctx)) throw new AppError('computersOff')
    await addComputerRule(ctx.workspace.id, params.id, body)
})
