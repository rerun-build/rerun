import { assertCanAdd, vaultContext } from '@/app/api/_services/vault.service'
import { requestingDesktop, vaultConnectUrl } from '@/app/api/v1/_lib/service-view'
import { getVaultItem } from '@/lib/engine/vault-client'
import { AppError } from '@/lib/i18n/action-error'
import { appReturnBase } from '@/lib/oauth/app-return'
import type { ConnectTarget } from '@rerun/contracts'
import { NextResponse } from 'next/server'
import { refusalResponse } from '../../_lib/refusal-response'

// The desktop app signs a Vault entry in through the system browser, which carries no session: the
// ticket stands in for it there, and the token comes back to this window through /authorized.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const { actor, conn } = await vaultContext()
        await assertCanAdd(actor)
        const item = await getVaultItem(conn, id)
        if (!item.oauth) throw new AppError('vaultEntryOtherServer')
        if (actor.kind !== 'user') throw new AppError('authorizationFailed')
        const target: ConnectTarget = { url: vaultConnectUrl(req, actor, item.id), returnUrl: appReturnBase(requestingDesktop(req)) }
        return NextResponse.json(target)
    } catch (err) {
        return refusalResponse(err, 'startOAuthFailed')
    }
}
