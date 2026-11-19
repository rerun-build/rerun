import type { VaultAccount } from '@rerun/contracts'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import type { VaultLending } from '@/data/useVaultAccounts'

type FromVaultProps = {
    slug: string
    vault: VaultLending
    disabled?: boolean
    onLent: (account: VaultAccount) => void
}

// The web card's block, word for word: "Already in the Vault", then one filled "Use <account>" per
// account, as wide as its text. A phone has no tooltip, so the reason a button is off is written under it.
export function FromVault({ slug, vault, disabled, onLent }: FromVaultProps) {
    const t = useTranslations('mobileCommon.vault')
    const accounts = vault.accountsFor(slug)
    const error = vault.errorFor(slug)
    if (accounts.length === 0) return null

    const use = async (account: VaultAccount) => {
        if (await vault.lend(account)) onLent(account)
    }

    return (
        <View style={{ gap: 6 }}>
            <AppText variant="footnote" tone="muted">
                {t('fromVault')}
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {accounts.map(account => (
                    <View key={account.id} style={{ maxWidth: '100%' }}>
                        <Button size="sm" label={t('useAccount', { label: account.label })} loading={vault.lending === account.id} disabled={disabled || !vault.canAttach || (vault.lending !== null && vault.lending !== account.id)} onPress={() => void use(account)} />
                    </View>
                ))}
            </View>
            {!vault.canAttach && (
                <AppText variant="footnote" tone="muted">
                    {t('manageBox')}
                </AppText>
            )}
            {error && (
                <AppText variant="footnote" tone="destructive">
                    {error}
                </AppText>
            )}
        </View>
    )
}
