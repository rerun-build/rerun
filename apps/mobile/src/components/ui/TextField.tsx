import { useState } from 'react'
import { TextInput, View } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { fieldOutline } from '@/theme/field'
import { useTheme } from '@/theme/theme'
import { controlSize, fonts, spacing } from '@/theme/tokens'

type TextFieldProps = {
    id: string
    label: string
    help?: string
    value: string
    onChangeText: (text: string) => void
    placeholder?: string
    secret?: boolean
    verbatim?: boolean
    multiline?: boolean
    autoFocus?: boolean
    maxLength?: number
    disabled?: boolean
}

export function TextField({ id, label, help, value, onChangeText, placeholder, secret, verbatim, multiline, autoFocus, maxLength, disabled }: TextFieldProps) {
    const theme = useTheme()
    const [focused, setFocused] = useState(false)
    return (
        <View style={{ gap: spacing.xs }}>
            <AppText variant="footnote" medium>
                {label}
            </AppText>
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={theme.mutedForeground}
                secureTextEntry={secret}
                autoCapitalize={secret || verbatim ? 'none' : 'sentences'}
                autoCorrect={!secret && !verbatim}
                autoComplete="off"
                textContentType={secret ? 'oneTimeCode' : 'none'}
                multiline={multiline}
                autoFocus={autoFocus}
                maxLength={maxLength}
                editable={!disabled}
                accessibilityLabel={label}
                accessibilityState={{ disabled }}
                testID={`field-${id}`}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={{ minHeight: multiline ? 96 : controlSize.md.height, paddingHorizontal: spacing.md, paddingTop: multiline ? spacing.md : undefined, textAlignVertical: multiline ? 'top' : 'center', borderRadius: controlSize.md.radius, borderCurve: 'continuous', ...fieldOutline(theme, { focused }), backgroundColor: theme.background, color: theme.foreground, fontFamily: fonts.regular, fontSize: 16, opacity: disabled ? 0.5 : 1 }}
            />
            {help && (
                <AppText variant="footnote" tone="muted">
                    {help}
                </AppText>
            )}
        </View>
    )
}
