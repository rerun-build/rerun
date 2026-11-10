import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { badgeLabel } from '@/components/inbox/inbox'
import { AppText } from '@/components/ui/AppText'
import { GLASS_BUTTON_SIZE, GlassButton } from '@/components/ui/GlassButton'
import { useTheme } from '@/theme/theme'

// The height of the Home's bottom bar: the search capsule and the bell.
export const BOTTOM_BAR_SIZE = GLASS_BUTTON_SIZE
const BADGE = 20

export function InboxButton({ count, onPress }: { count: number; onPress: () => void }) {
    const theme = useTheme()
    const label = badgeLabel(count)
    const t = useTranslations('mobileHome')
    return (
        <View>
            <GlassButton symbol="bell" label={count > 0 ? t('inbox.bellLabel', { count }) : t('inbox.notifications')} onPress={onPress} />
            {count > 0 && (
                <View pointerEvents="none" style={{ position: 'absolute', top: -2, right: -2, width: BADGE, height: BADGE, borderRadius: BADGE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.destructive }}>
                    <AppText variant="caption" medium maxFontSizeMultiplier={1} style={{ color: '#ffffff', fontSize: label.length > 2 ? 8 : 11, lineHeight: 13, fontVariant: ['tabular-nums'] }}>
                        {label}
                    </AppText>
                </View>
            )}
        </View>
    )
}
