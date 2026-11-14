import type { GlassViewProps } from 'expo-glass-effect'
import { View } from 'react-native'

import { opaqueSurface } from '@/components/ui/surface'
import { useTheme } from '@/theme/theme'

export type GlassSurfaceProps = GlassViewProps

export function GlassSurface({ glassEffectStyle: _style, tintColor: _tint, isInteractive: _interactive, colorScheme, style, ...rest }: GlassSurfaceProps) {
    const theme = useTheme()
    const scheme = colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : theme.scheme
    return <View {...rest} style={[opaqueSurface(scheme), style]} />
}
