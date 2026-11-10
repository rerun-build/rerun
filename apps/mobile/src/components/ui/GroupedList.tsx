import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Skeleton } from '@/components/ui/Skeleton'
import { Switch } from '@/components/ui/Switch'
import { useTheme } from '@/theme/theme'
import { brand, radius, spacing } from '@/theme/tokens'

export const GROUPED_ROW_HEIGHT = 52

export function Card({ children }: { children: ReactNode }) {
    const theme = useTheme()
    return <View style={{ borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: theme.card, overflow: 'hidden' }}>{children}</View>
}

export function Separator({ inset = spacing.lg }: { inset?: number }) {
    const theme = useTheme()
    return <View style={{ height: 1, marginLeft: inset, backgroundColor: theme.border }} />
}

export function SectionTitle({ children }: { children: string }) {
    return (
        <AppText variant="footnote" tone="muted" medium style={{ paddingHorizontal: spacing.lg }}>
            {children}
        </AppText>
    )
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
    return (
        <View style={{ gap: spacing.sm }}>
            {title && <SectionTitle>{title}</SectionTitle>}
            <Card>{children}</Card>
        </View>
    )
}

type SettingsRowProps = {
    label: string
    value?: string
    // The value is still on its way: a placeholder holds its place.
    loading?: boolean
    icon?: IconName
    accessory?: 'external' | 'chevron'
    tone?: 'default' | 'destructive'
    disabled?: boolean
    onPress?: () => void
    testID?: string
}

const ROW_STYLE = { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: GROUPED_ROW_HEIGHT, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm } as const

// The inset that lines a separator up with the label of a row that has an icon.
export const ICON_ROW_INSET = spacing.lg + 24 + spacing.md

export function SettingsRow({ label, value, loading, icon, accessory, tone = 'default', disabled, onPress, testID }: SettingsRowProps) {
    const theme = useTheme()
    const trailingSymbol: IconName | null = accessory === 'external' ? 'arrow-up-right' : accessory === 'chevron' ? 'chevron-right' : null
    const content = (
        <>
            {icon && (
                <View style={{ width: 24, alignItems: 'center' }}>
                    <Icon name={icon} size={18} color={theme.mutedForeground} />
                </View>
            )}
            <AppText variant="body" tone={tone} numberOfLines={1} style={{ flexShrink: 0, maxWidth: '70%' }}>
                {label}
            </AppText>
            <View style={{ flex: 1 }} />
            {loading ? (
                <Skeleton style={{ width: 72, height: 14 }} />
            ) : value ? (
                <AppText variant="body" tone="muted" numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>
                    {value}
                </AppText>
            ) : null}
            {trailingSymbol && <Icon name={trailingSymbol} size={13} color={theme.mutedForeground} />}
        </>
    )

    if (!onPress) return <View testID={testID} style={ROW_STYLE}>{content}</View>
    return (
        <Pressable testID={testID} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={({ pressed }) => [ROW_STYLE, { backgroundColor: pressed ? theme.muted : 'transparent', opacity: disabled ? 0.45 : 1 }]}>
            {content}
        </Pressable>
    )
}

type SwitchRowProps = {
    label: string
    value: boolean
    onValueChange: (value: boolean) => void
    disabled?: boolean
    testID?: string
}

export function SwitchRow({ label, value, onValueChange, disabled, testID }: SwitchRowProps) {
    return (
        <View style={ROW_STYLE}>
            <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                {label}
            </AppText>
            <Switch testID={testID} value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={label} />
        </View>
    )
}

type CheckRowProps = {
    label: string
    detail?: string
    icon?: IconName
    // Drawn after the label, a « Recommended » badge for one.
    badge?: ReactNode
    checked: boolean
    disabled?: boolean
    onPress: () => void
    testID?: string
}

// One answer of a single-choice list, the iOS Settings way: the chosen one carries the checkmark.
export function CheckRow({ label, detail, icon, badge, checked, disabled, onPress, testID }: CheckRowProps) {
    const theme = useTheme()
    return (
        <Pressable
            testID={testID}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={detail ? `${label}, ${detail}` : label}
            accessibilityState={{ checked, disabled }}
            style={({ pressed }) => [ROW_STYLE, { alignItems: detail ? 'flex-start' : 'center', backgroundColor: pressed ? theme.muted : 'transparent', opacity: disabled ? 0.45 : 1 }]}
        >
            {icon && (
                <View style={{ width: 24, alignItems: 'center', paddingTop: detail ? 2 : 0 }}>
                    <Icon name={icon} size={18} color={theme.mutedForeground} />
                </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
                    <AppText variant="body" style={{ flexShrink: 1 }}>
                        {label}
                    </AppText>
                    {badge}
                </View>
                {detail ? (
                    <AppText variant="footnote" tone="muted">
                        {detail}
                    </AppText>
                ) : null}
            </View>
            <View style={{ width: 20, alignItems: 'center', paddingTop: detail ? 3 : 0 }}>{checked && <Icon name="check" size={16} bold color={theme.scheme === 'dark' ? brand.soft : brand.base} />}</View>
        </Pressable>
    )
}
