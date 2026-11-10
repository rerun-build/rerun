import { SymbolView } from 'expo-symbols'
import { Pressable, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

import { AVATAR } from './CoworkerRow'

// Last in the list, where an iOS list offers to add one more.
export function NewCoworkerRow({ onPress }: { onPress: () => void }) {
    const theme = useTheme()
    const t = useTranslations('mobileHome')
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('newCoworker')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border }}>
                <SymbolView name="plus" size={16} weight="semibold" tintColor={theme.mutedForeground} />
            </View>
            <AppText variant="body" tone="muted">
                {t('newCoworker')}
            </AppText>
        </Pressable>
    )
}
