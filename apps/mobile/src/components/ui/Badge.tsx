import { View } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { useTheme } from '@/theme/theme'
import { brand, radius, withAlpha, type ColorScheme } from '@/theme/tokens'

export type BadgeTone = 'brand' | 'green' | 'red' | 'orange' | 'yellow' | 'cyan' | 'neutral'

export const TONES: Record<string, Record<ColorScheme, string>> = {
    brand: { light: brand.base, dark: brand.soft },
    green: { light: '#059669', dark: '#34d399' },
    red: { light: '#dc2626', dark: '#f87171' },
    orange: { light: '#ea580c', dark: '#f97316' },
    yellow: { light: '#ca8a04', dark: '#facc15' },
    cyan: { light: '#0e7490', dark: '#22d3ee' },
}

const SIZES = {
    xs: { paddingHorizontal: 7, paddingVertical: 1, fontSize: 11, lineHeight: 15 },
    sm: { paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, lineHeight: 16 },
} as const

export function Badge({ label, tone = 'neutral', size = 'sm' }: { label: string; tone?: BadgeTone | (string & {}); size?: keyof typeof SIZES }) {
    const theme = useTheme()
    const color = TONES[tone]?.[theme.scheme] ?? theme.mutedForeground
    const { fontSize, lineHeight, ...padding } = SIZES[size]
    return (
        <View style={{ alignSelf: 'flex-start', ...padding, borderRadius: radius.pill, borderWidth: 1, borderColor: withAlpha(color, 0.3), backgroundColor: withAlpha(color, tone === 'brand' ? 0.1 : 0.12) }}>
            <AppText numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize, lineHeight, color }}>
                {label}
            </AppText>
        </View>
    )
}
