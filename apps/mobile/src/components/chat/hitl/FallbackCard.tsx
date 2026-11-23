import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import type { IconName } from '@/components/ui/Icon'
import { openInPhoneBrowser } from '@/lib/url'
import { spacing } from '@/theme/tokens'

import { HitlAction, HitlCard } from './HitlCard'

// What a block asks, as text, for a block the app cannot draw: answered in the composer, or on the web
// where every block is drawn. `replyHere` false: what is asked must not be typed in the chat, a key.
export function FallbackCard({ symbol, label, ask, webUrl, replyHere = true, onClose }: { symbol: IconName; label: string; ask: string | null; webUrl: string; replyHere?: boolean; onClose?: () => void }) {
    const t = useTranslations('mobileHitl')
    return (
        <HitlCard symbol={symbol} label={label} onClose={onClose} closeLabel={t('secret.dismiss')}>
            {ask && <AppText variant="body">{ask}</AppText>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <AppText variant="footnote" tone="muted">
                    {replyHere ? t('fallback.replyBelow') : t('fallback.typeOnWeb')}
                </AppText>
                <HitlAction label={t('actions.openOnWeb')} primary onPress={() => openInPhoneBrowser(webUrl)} />
            </View>
        </HitlCard>
    )
}
