import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocale, useTranslations } from 'use-intl'

import { useSignInFlow } from '@/components/auth/SignInFlow'
import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import * as Haptics from '@/lib/haptics'
import { searchCountries, type PhoneCountry } from '@/lib/phone'
import { useTheme } from '@/theme/theme'
import { brand, fonts, radius, spacing } from '@/theme/tokens'

const ROW = 52

export default function PickCountry() {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const { country, setCountry } = useSignInFlow()
    const t = useTranslations('mobileAuth')
    const locale = useLocale()
    const [query, setQuery] = useState('')
    const results = useMemo(() => searchCountries(query, locale), [query, locale])

    const pick = (picked: PhoneCountry) => {
        Haptics.selectionAsync()
        setCountry(picked.code)
        router.back()
    }

    // A form sheet lays out at most a header and a list: the header must not be flattened away, and
    // nothing may wrap the two.
    return (
        <>
            <View collapsable={false} style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: theme.muted }}>
                    <Icon name="search" size={15} color={theme.mutedForeground} />
                    <TextInput value={query} onChangeText={setQuery} placeholder={t('country.search')} placeholderTextColor={theme.mutedForeground} autoCorrect={false} accessibilityLabel={t('country.searchLabel')} style={{ flex: 1, height: '100%', fontFamily: fonts.regular, fontSize: 16, color: theme.foreground }} />
                </View>
            </View>
            <FlatList
                data={results}
                keyExtractor={item => item.code}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
                renderItem={({ item }) => (
                    <Pressable onPress={() => pick(item)} testID={`country-${item.code}`} accessibilityRole="button" accessibilityLabel={item.name} accessibilityState={{ selected: item.code === country }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: ROW, paddingHorizontal: spacing.xl, backgroundColor: pressed ? theme.muted : 'transparent' })}>
                        <AppText variant="body">{item.flag}</AppText>
                        <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                            {item.name}
                        </AppText>
                        <AppText variant="body" tone="muted">
                            +{item.callingCode}
                        </AppText>
                        <View style={{ width: 18 }}>{item.code === country && <Icon name="check" size={16} bold color={theme.scheme === 'dark' ? brand.soft : brand.base} />}</View>
                    </Pressable>
                )}
            />
        </>
    )
}
