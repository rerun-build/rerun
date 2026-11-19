import { View } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { GLASS_BUTTON_SIZE, GlassButton } from '@/components/ui/GlassButton'
import { Icon } from '@/components/ui/Icon'
import { NativeMenu } from '@/components/ui/NativeMenu'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

import type { BrowserBarProps } from './browser-bar-types'

// Android has no glass: its opaque twins keep the theme's colors, legible over any page.
export function BrowserBar({ host, labels, onClose, onReload, children }: BrowserBarProps) {
    const theme = useTheme()
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <GlassButton symbol="x" label={labels.close} onPress={onClose} />
            <View style={{ flex: 1 }}>
                <NativeMenu
                    glass="capsule"
                    label={labels.pageActions}
                    trigger={
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: GLASS_BUTTON_SIZE, paddingHorizontal: spacing.lg }}>
                            <AppText variant="footnote" medium numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flexShrink: 1 }}>
                                {host}
                            </AppText>
                            <Icon name="ellipsis" size={14} color={theme.mutedForeground} />
                        </View>
                    }
                >
                    {children}
                </NativeMenu>
            </View>
            <GlassButton symbol="refresh-cw" label={labels.reload} onPress={onReload} />
        </View>
    )
}
