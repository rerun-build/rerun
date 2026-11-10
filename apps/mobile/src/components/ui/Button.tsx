import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { Icon, type IconName } from '@/components/ui/Icon'
import { ctaRelief, destructiveRelief, solidRelief, subtleRelief } from '@/theme/relief'
import { useTheme } from '@/theme/theme'
import { controlSize, fonts, spacing, withAlpha, type ControlSize } from '@/theme/tokens'

export type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive'

type ButtonProps = {
    label: string
    onPress: () => void
    variant?: ButtonVariant
    size?: ControlSize
    symbol?: IconName
    // For a glyph outside the icon set (a provider logo, the Apple logo).
    icon?: ReactNode
    iconOnly?: boolean
    // Shares the row's width with its siblings, iconOnly included.
    stretch?: boolean
    loading?: boolean
    disabled?: boolean
}

const LABEL = {
    sm: { fontSize: 14, lineHeight: 18, symbol: 14 },
    md: { fontSize: 15, lineHeight: 20, symbol: 16 },
    lg: { fontSize: 16, lineHeight: 22, symbol: 17 },
} as const

type Theme = ReturnType<typeof useTheme>
type Look = { color: string; backgroundColor: string; borderColor: string; boxShadow?: string }

function lookOf(theme: Theme, variant: ButtonVariant, size: ControlSize, pressed: boolean): Look {
    const dark = theme.scheme === 'dark'
    const state = pressed ? 'pressed' : 'rest'
    switch (variant) {
        case 'default':
            return { color: theme.primaryForeground, backgroundColor: theme.primary, borderColor: 'transparent', boxShadow: (size === 'lg' ? ctaRelief : solidRelief)[theme.scheme][state] }
        case 'outline':
            return {
                color: theme.foreground,
                backgroundColor: pressed ? theme.muted : dark ? withAlpha('#ffffff', 0.045) : theme.card,
                borderColor: dark ? theme.input : theme.border,
                boxShadow: subtleRelief[theme.scheme][state],
            }
        case 'secondary':
            return { color: theme.foreground, backgroundColor: theme.secondary, borderColor: 'transparent', boxShadow: subtleRelief[theme.scheme][state] }
        case 'ghost':
            return { color: theme.foreground, backgroundColor: pressed ? (dark ? withAlpha(theme.muted, 0.5) : theme.muted) : 'transparent', borderColor: 'transparent' }
        case 'destructive':
            return {
                color: theme.destructive,
                backgroundColor: withAlpha(theme.destructive, (dark ? 0.2 : 0.1) + (pressed ? 0.1 : 0)),
                borderColor: withAlpha(theme.destructive, (dark ? 0.25 : 0.15) + (pressed ? 0.1 : 0)),
                boxShadow: destructiveRelief[theme.scheme][state],
            }
    }
}

// The web Button (packages/ui/src/primitives/button-variants.ts) at touch sizes: same variants, same
// reliefs, same one-pixel sink on press. Loading stays the native spinner.
export function Button({ label, onPress, variant = 'default', size = 'md', symbol, icon, iconOnly, stretch, loading, disabled }: ButtonProps) {
    const theme = useTheme()
    const inactive = disabled || loading
    const { height, radius } = controlSize[size]
    const text = LABEL[size]
    const frame = (pressed: boolean): ViewStyle => {
        const look = lookOf(theme, variant, size, pressed)
        return {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: size === 'sm' ? 6 : spacing.sm,
            height,
            flex: stretch ? 1 : undefined,
            width: iconOnly && !stretch ? height : undefined,
            paddingHorizontal: iconOnly ? 0 : size === 'lg' ? spacing.xl : spacing.lg,
            borderRadius: radius,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: look.borderColor,
            backgroundColor: look.backgroundColor,
            boxShadow: look.boxShadow,
            opacity: disabled ? 0.5 : 1,
            transform: [{ translateY: pressed ? 1 : 0 }],
        }
    }
    return (
        <Pressable
            onPress={onPress}
            disabled={inactive}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: inactive, busy: loading }}
            hitSlop={size === 'sm' ? 4 : undefined}
            style={({ pressed }) => frame(pressed)}
        >
            {({ pressed }) => {
                const { color } = lookOf(theme, variant, size, pressed)
                return (
                    <>
                        {loading ? <ActivityIndicator size="small" color={color} /> : symbol ? <Icon name={symbol} size={text.symbol} color={color} /> : icon && <View>{icon}</View>}
                        {!iconOnly && (
                            <AppText numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontFamily: fonts.medium, fontSize: text.fontSize, lineHeight: text.lineHeight, letterSpacing: -0.2, color, flexShrink: 1 }}>
                                {label}
                            </AppText>
                        )}
                    </>
                )
            }}
        </Pressable>
    )
}
