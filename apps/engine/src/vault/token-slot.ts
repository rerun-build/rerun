import type { TokenSlot } from '../tools/mcp-auth.js'
import { logger } from '../lib/logger.js'
import { sendNotification } from '../runtime/notify.js'
import { findVaultItem, updateVaultItem } from './store.js'
import { loadVaultToken, saveVaultToken } from './tokens.js'

// The token of a Vault item, refreshed once for every coworker drawing on it.
export function vaultTokenSlot(itemId: string, name: string): TokenSlot {
    return {
        key: `vault:${itemId}/${name}`,
        load: () => loadVaultToken(itemId, name),
        save: token => saveVaultToken(itemId, name, token),
        refused: () => markVaultItemSignedOut(itemId),
    }
}

// A refresh refused for good leaves the account unusable until someone signs in again: the item says
// so, which is what the Vault and every coworker using it show, and the hub hears about it at once.
export async function markVaultItemSignedOut(itemId: string): Promise<void> {
    const item = findVaultItem(itemId)
    if (!item || item.config.status === 'needs_auth') return
    try {
        await updateVaultItem(itemId, { status: 'needs_auth' })
    } catch (err) {
        logger.warn({ item: itemId, err: String(err) }, 'vault item could not be marked signed out')
        return
    }
    logger.warn({ item: itemId }, 'vault item signed out: its token can no longer be refreshed')
    void sendNotification({ event: 'box.vault.signed_out', kind: 'connector', agentId: null, message: item.config.name, metadata: { itemId, slug: item.config.slug } })
}
