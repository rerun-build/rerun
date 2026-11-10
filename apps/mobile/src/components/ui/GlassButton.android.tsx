import { createContext, use } from 'react'
import { Pressable } from 'react-native'

import { Icon, type IconName } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { palette, withAlpha } from '@/theme/tokens'

export const GLASS_BUTTON_SIZE = 44
export const GLASS_INSET = 7

// Android has no system glass: the twins draw an opaque surface, so there is nothing to switch off.
export const GlassShown = createContext(true)

export function useGlassStyle() {
    const shown = use(GlassShown)
    return { style: shown ? 'regular' : 'none', animate: true, animationDuration: 0.25 } as const
}

type GlassButtonProps = {
    symbol: IconName
    label: string
    onPress: () => void
    disabled?: boolean
    size?: number
    scheme?: 'light' | 'dark'
}

// The iOS glass button's Android twin: same shape and place, an opaque surface with a hairline and
// the ripple Android users expect, in place of the glass.
export function GlassButton({ symbol, label, onPress, disabled = false, size = GLASS_BUTTON_SIZE, scheme }: GlassButtonProps) {
    const theme = useTheme()
    const colors = palette[scheme ?? theme.scheme]
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            android_ripple={{ color: withAlpha(colors.foreground, 0.12), borderless: true, radius: size / 2 }}
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: withAlpha(colors.card, 0.92),
                borderWidth: 1,
                borderColor: withAlpha(colors.foreground, 0.08),
                boxShadow: `0 1px 3px ${withAlpha('#000000', 0.12)}`,
                opacity: disabled ? 0.4 : 1,
            }}
        >
            <Icon name={symbol} size={Math.round(size * 0.45)} color={colors.foreground} />
        </Pressable>
    )
}
