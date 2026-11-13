import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { AppText } from '@/components/ui/AppText'
import { BorderBeam, type BeamTone } from '@/components/ui/BorderBeam'
import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { IconTile } from '@/components/ui/IconTile'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

export function HitlIcon({ symbol, beam = 'brand' }: { symbol: IconName; beam?: BeamTone }) {
    return <IconTile symbol={symbol} tone={beam === 'orange' ? 'orange' : 'neutral'} />
}

function CloseButton({ onClose, closeLabel }: { onClose: () => void; closeLabel?: string }) {
    const theme = useTheme()
    return (
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
            <Icon name="x" size={13} bold color={theme.mutedForeground} />
        </Pressable>
    )
}

// The frame every HITL widget is drawn in: the web's icon box and title, and a way to close it when the
// ask can be closed. The beam on its border is the web's, orange for an approval. Without a `label` the
// widget draws its own heading (a question puts the icon beside its text), the close button sits in
// the corner.
export function HitlCard({ symbol, label, beam = 'brand', onClose, closeLabel, children }: { symbol: IconName; label?: string; beam?: BeamTone; onClose?: () => void; closeLabel?: string; children: ReactNode }) {
    const theme = useTheme()
    return (
        <View style={{ gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card }}>
            <BorderBeam tone={beam} radius={radius.lg} surface={theme.card} />
            {label ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <HitlIcon symbol={symbol} beam={beam} />
                    <AppText variant="callout" medium numberOfLines={1} style={{ flex: 1 }}>
                        {label}
                    </AppText>
                    {onClose && <CloseButton onClose={onClose} closeLabel={closeLabel} />}
                </View>
            ) : (
                onClose && (
                    <View style={{ position: 'absolute', top: spacing.lg + 9, right: spacing.lg, zIndex: 1 }}>
                        <CloseButton onClose={onClose} closeLabel={closeLabel} />
                    </View>
                )
            )}
            {children}
        </View>
    )
}

// A small action under a widget, the web's: the main one filled, the others outlined, a quiet one bare.
export function HitlAction({ label, onPress, primary, tone, disabled }: { label: string; onPress: () => void; primary?: boolean; tone?: 'destructive' | 'quiet'; disabled?: boolean }) {
    return <Button label={label} onPress={onPress} size="sm" disabled={disabled} variant={primary ? 'default' : tone === 'destructive' ? 'destructive' : tone === 'quiet' ? 'ghost' : 'outline'} />
}

