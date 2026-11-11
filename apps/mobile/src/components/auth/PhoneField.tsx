import type { CountryCode } from 'libphonenumber-js/min'
import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { countryByCode, examplePlaceholder, formatAsTyped } from '@/lib/phone'
import { fieldOutline } from '@/theme/field'
import { useTheme } from '@/theme/theme'
import { controlSize, fonts, spacing } from '@/theme/tokens'

export const FIELD_HEIGHT = controlSize.lg.height
export const FIELD_RADIUS = controlSize.lg.radius

type PhoneFieldProps = {
    country: CountryCode
    value: string
    onChangeText: (value: string) => void
    onPickCountry: () => void
    onSubmit?: () => void
    autoFocus?: boolean
    invalid?: boolean
}

export function PhoneField({ country, value, onChangeText, onPickCountry, onSubmit, autoFocus, invalid }: PhoneFieldProps) {
    const theme = useTheme()
    const [focused, setFocused] = useState(false)
    const t = useTranslations('mobileAuth')
    const locale = useLocale()
    const { flag, callingCode, name } = countryByCode(country, locale)
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', height: FIELD_HEIGHT, borderRadius: FIELD_RADIUS, borderCurve: 'continuous', ...fieldOutline(theme, { focused, invalid }), backgroundColor: theme.card }}>
            <Pressable onPress={onPickCountry} accessibilityRole="button" accessibilityLabel={t('phone.countryLabel', { name })} hitSlop={4} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: '100%', paddingLeft: spacing.lg, paddingRight: spacing.md, opacity: pressed ? 0.6 : 1 })}>
                <AppText variant="body" maxFontSizeMultiplier={1.2}>
                    {flag}
                </AppText>
                <AppText variant="body" maxFontSizeMultiplier={1.2}>
                    +{callingCode}
                </AppText>
                <Icon name="chevron-down" size={11} bold color={theme.mutedForeground} />
            </Pressable>
            <View style={{ width: 1, height: 24, backgroundColor: theme.border }} />
            <TextInput
                value={value}
                onChangeText={text => onChangeText(formatAsTyped(text, country))}
                onSubmitEditing={onSubmit}
                placeholder={examplePlaceholder(country)}
                placeholderTextColor={theme.mutedForeground}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                autoFocus={autoFocus}
                accessibilityLabel={t('phone.numberLabel')}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                maxFontSizeMultiplier={1.3}
                style={{ flex: 1, height: '100%', paddingHorizontal: spacing.md, fontFamily: fonts.regular, fontSize: 17, color: theme.foreground }}
            />
        </View>
    )
}
