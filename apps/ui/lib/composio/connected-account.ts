import { sleep } from '@rerun/contracts'

import { AppError } from '@/lib/i18n/action-error'
import { getConnectedAccount } from './client'

const ACTIVE_POLL_ATTEMPTS = 5
const ACTIVE_POLL_DELAY_MS = 1000

// A sign-in is only worth what Composio says of the account it made: the expected user, made with the
// app's own auth config, and active.
export async function assertConnectedAccount(connectedAccountId: string, expected: { userId: string; authConfigId: string }): Promise<void> {
    let account = await getConnectedAccount(connectedAccountId)
    for (let attempt = 1; account.status !== 'ACTIVE' && account.status !== 'FAILED' && attempt < ACTIVE_POLL_ATTEMPTS; attempt++) {
        await sleep(ACTIVE_POLL_DELAY_MS)
        account = await getConnectedAccount(connectedAccountId)
    }
    if (account.userId !== expected.userId || account.authConfigId !== expected.authConfigId) {
        console.warn(`[composio] connected account ${connectedAccountId} does not match the pending context`)
        throw new AppError('connectionMismatch')
    }
    if (account.status !== 'ACTIVE') throw new AppError('connectionNotActiveYet', { status: account.status })
}
