import { actorFromContext } from '@/app/api/_auth/access'
import { attachVaultEntry, coworkerVault } from '@/app/api/_services/vault.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi, vaultAccounts } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The Vault's accounts the coworker could be lent instead of signing in to an app again. A Box without
// a Vault has none to offer.
export const GET = apiRoute(mobileApi.listVaultAccounts, { auth: 'member' }, async ({ ctx, params }) => {
    const vault = await coworkerVault(params.id, actorFromContext(ctx))
    return vault ? { canAttach: vault.canAttach, accounts: vaultAccounts(vault.available) } : { canAttach: false, accounts: [] }
})

export const POST = apiRoute(mobileApi.lendVaultAccount, { auth: 'member' }, async ({ ctx, params, body }) => {
    await attachVaultEntry(body.itemId, params.id, actorFromContext(ctx))
})
