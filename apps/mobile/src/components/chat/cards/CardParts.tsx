import { Image } from 'expo-image'
import { useState, type ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'

import { fileHeadersFor } from '@/api/files'
import { useAuth } from '@/auth/AuthProvider'
import { AppText } from '@/components/ui/AppText'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

export function CardFrame({ symbol, title, meta, children }: { symbol: IconName; title: string; meta?: string; children: ReactNode }) {
    const theme = useTheme()
    return (
        <View style={{ borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <Icon name={symbol} size={13} color={theme.mutedForeground} />
                <AppText variant="footnote" medium numberOfLines={1} style={{ flex: 1 }}>
                    {title}
                </AppText>
                {meta && (
                    <AppText variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                        {meta}
                    </AppText>
                )}
            </View>
            {children}
        </View>
    )
}

// An image behind the hub's auth: the request carries the same headers as every other call. A broken
// one falls back to a glyph rather than an empty box.
export function AuthedImage({ url, fallback = 'image', style }: { url: string | null; fallback?: IconName; style: StyleProp<ViewStyle> }) {
    const theme = useTheme()
    const { session, me } = useAuth()
    const [broken, setBroken] = useState<string | null>(null)
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    return (
        <View style={[{ overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }, style]}>
            {url && broken !== url ? (
                <Image source={{ uri: url, headers: fileHeadersFor(caller, url) }} contentFit="cover" onError={() => setBroken(url)} style={{ width: '100%', height: '100%' }} />
            ) : (
                <Icon name={fallback} size={14} color={theme.mutedForeground} />
            )}
        </View>
    )
}
