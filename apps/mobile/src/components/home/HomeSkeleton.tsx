import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AVATAR, COWORKER_ROW_HEIGHT } from '@/components/home/CoworkerRow'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

export const SKELETON_ROWS = 6

// Where a CoworkerRow draws its avatar, its name and its status line. The native launch screen
// draws the same shapes (plugins/with-home-launch-screen.js), so the app takes over without a jump.
export const SKELETON = {
    avatarTop: spacing.md + 2,
    textLeft: spacing.xl + AVATAR + spacing.lg,
    nameTop: spacing.md + 4,
    nameHeight: 14,
    statusTop: spacing.md + 28,
    statusHeight: 12,
} as const

// How far each bar reaches across the text column, in percent: uneven, the way real names are.
export function skeletonBarWidths(index: number) {
    return { name: 40 + ((index * 17) % 30), status: 60 + ((index * 23) % 30) }
}

// The shape of the rows to come, as the web loads: never a spinner in the middle of the screen.
export function HomeSkeleton({ rows = SKELETON_ROWS }: { rows?: number }) {
    const t = useTranslations('mobileHome')
    return (
        <View accessibilityLabel={t('loadingCoworkers')}>
            {Array.from({ length: rows }, (_, index) => (
                <SkeletonRow key={index} index={index} />
            ))}
        </View>
    )
}

export function SkeletonRow({ index, opaque = false }: { index: number; opaque?: boolean }) {
    const theme = useTheme()
    const widths = skeletonBarWidths(index)
    return (
        <View style={{ height: COWORKER_ROW_HEIGHT, backgroundColor: opaque ? theme.background : undefined }}>
            <View style={{ position: 'absolute', left: spacing.xl, top: SKELETON.avatarTop, width: AVATAR, height: AVATAR, borderRadius: radius.md, backgroundColor: theme.muted }} />
            <View style={{ position: 'absolute', left: SKELETON.textLeft, right: spacing.xl, top: 0, bottom: 0 }}>
                <View style={{ position: 'absolute', top: SKELETON.nameTop, width: `${widths.name}%`, height: SKELETON.nameHeight, borderRadius: radius.sm, backgroundColor: theme.muted }} />
                <View style={{ position: 'absolute', top: SKELETON.statusTop, width: `${widths.status}%`, height: SKELETON.statusHeight, borderRadius: radius.sm, backgroundColor: theme.muted }} />
            </View>
        </View>
    )
}
