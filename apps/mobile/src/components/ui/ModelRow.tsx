import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { GROUPED_ROW_HEIGHT } from '@/components/ui/GroupedList'
import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { brand, spacing } from '@/theme/tokens'

// One model in a picker: ticked when it is the one, a lock when the plan does not include it.
// `disabled` keeps the tick: the choice is shown, only not changeable.
export function ModelRow({ id, label, description, selected, locked, disabled, leading, onPress }: { id: string; label: string; description?: string; selected: boolean; locked?: boolean; disabled?: boolean; leading: ReactNode; onPress: () => void }) {
    const theme = useTheme()
    const inactive = locked || disabled
    return (
        <Pressable onPress={onPress} disabled={inactive} testID={id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: inactive }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: GROUPED_ROW_HEIGHT, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: pressed ? theme.muted : 'transparent', opacity: inactive ? 0.5 : 1 })}>
            <View style={{ width: 20, alignItems: 'center' }}>{leading}</View>
            <View style={{ flex: 1 }}>
                <AppText variant="body" numberOfLines={1}>
                    {label}
                </AppText>
                {description ? (
                    <AppText variant="footnote" tone="muted" numberOfLines={2}>
                        {description}
                    </AppText>
                ) : null}
            </View>
            {locked ? <Icon name="lock" size={14} color={theme.mutedForeground} /> : selected ? <Icon name="check" size={16} bold color={theme.scheme === 'dark' ? brand.soft : brand.base} /> : null}
        </Pressable>
    )
}
