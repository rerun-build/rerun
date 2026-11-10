import { useLocalSearchParams } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppleLogo } from '@/components/auth/AppleLogo'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { GlassButton } from '@/components/ui/GlassButton'
import { Icon } from '@/components/ui/Icon'
import { ICON_NAMES } from '@/components/ui/icon-names'
import { IconTile } from '@/components/ui/IconTile'
import { ThemeScope, useTheme } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

// Dev only: every icon of the app at the sizes it is drawn at, and the controls that carry one.
//   /lab-icons?scheme=dark   /lab-icons?size=24

const noop = () => {}
const CELL = 76

function Grid({ size }: { size: number }) {
    const theme = useTheme()
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {ICON_NAMES.map(name => (
                <View key={name} style={{ width: CELL, alignItems: 'center', gap: 6, paddingVertical: spacing.sm }}>
                    <Icon name={name} size={size} color={theme.foreground} />
                    <AppText variant="caption" tone="muted" numberOfLines={2} style={{ fontSize: 9, lineHeight: 11, textAlign: 'center' }}>
                        {name}
                    </AppText>
                </View>
            ))}
        </View>
    )
}

function Controls() {
    const theme = useTheme()
    return (
        <View style={{ gap: spacing.lg }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' }}>
                <GlassButton symbol="chevron-left" label="Back" onPress={noop} />
                <GlassButton symbol="x" label="Close" onPress={noop} />
                <GlassButton symbol="settings" label="Settings" onPress={noop} />
                <GlassButton symbol="share" label="Share" onPress={noop} />
                <GlassButton symbol="arrow-down" label="Scroll to latest" size={36} onPress={noop} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' }}>
                <Button label="New chat" symbol="plus" onPress={noop} />
                <Button label="Edit" variant="outline" size="sm" symbol="pencil" onPress={noop} />
                <Button label="Apple" variant="outline" iconOnly icon={<AppleLogo />} onPress={noop} />
                <Button label="Delete" variant="destructive" symbol="trash" onPress={noop} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' }}>
                <IconTile symbol="brain" />
                <IconTile symbol="calendar-clock" tone="orange" />
                <Icon name="circle-check-fill" size={18} color="#16a34a" />
                <Icon name="circle-x-fill" size={18} color={theme.destructive} />
                <Icon name="thumbs-up-fill" size={18} color={theme.foreground} />
                <Icon name="stop-fill" size={15} color={theme.foreground} />
                <Icon name="play-fill" size={13} color={theme.foreground} />
                <Icon name="pause-fill" size={13} color={theme.foreground} />
                <Icon name="square-check-fill" size={16} color={theme.foreground} />
                <Icon name="arrow-up" size={15} bold color={theme.foreground} />
            </View>
        </View>
    )
}

export default function LabIcons() {
    const params = useLocalSearchParams<{ scheme?: ColorScheme; size?: string }>()
    const insets = useSafeAreaInsets()
    const scheme: ColorScheme = params.scheme === 'dark' ? 'dark' : 'light'
    const sizes = params.size ? [Number(params.size)] : [13, 18]
    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ flex: 1, backgroundColor: palette[scheme].background }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.xl }}>
                <Controls />
                {sizes.map(size => (
                    <View key={size} style={{ gap: spacing.sm }}>
                        <AppText variant="footnote" tone="muted" medium>
                            {`${ICON_NAMES.length} icons · ${size} pt`}
                        </AppText>
                        <Grid size={size} />
                    </View>
                ))}
            </ScrollView>
        </ThemeScope>
    )
}
