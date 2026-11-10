import * as WebBrowser from 'expo-web-browser'
import type { SFSymbol } from 'expo-symbols'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { spacing } from '@/theme/tokens'

import { HitlAction, HitlCard } from './HitlCard'

// What a block asks, as text, for a block the app cannot draw: answered in the composer, or on the web
// where every block is drawn.
export function FallbackCard({ symbol, label, ask, webUrl }: { symbol: SFSymbol; label: string; ask: string | null; webUrl: string }) {
    const t = useTranslations('mobileHitl')
    return (
        <HitlCard symbol={symbol} label={label}>
            {ask && <AppText variant="body">{ask}</AppText>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <AppText variant="footnote" tone="muted">
                    {t('fallback.replyBelow')}
                </AppText>
                <HitlAction label={t('actions.openOnWeb')} primary onPress={() => WebBrowser.openBrowserAsync(webUrl)} />
            </View>
        </HitlCard>
    )
}
