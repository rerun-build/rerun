import { View } from 'react-native'

import { AVATAR, COWORKER_ROW_HEIGHT, HOME_GUTTER } from '@/components/home/CoworkerRow'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

export const SKELETON_ROWS = 6

// Where a CoworkerRow draws its avatar, its name and its status line. The native launch screen
// draws the same shapes (plugins/with-home-launch-screen.js), so the app takes over without a jump.
export const SKELETON = {
    avatarTop: spacing.lg,
    textLeft: HOME_GUTTER + AVATAR + spacing.lg,
    nameTop: spacing.lg + 4,
    nameHeight: 14,
    statusTop: spacing.lg + 28,
    statusHeight: 12,
} as const

// How far each bar reaches across the text column, in percent: uneven, the way real names are.
export function skeletonBarWidths(index: number) {
    return { name: 40 + ((index * 17) % 30), status: 60 + ((index * 23) % 30) }
}

// The shape of the rows to come, as the web loads: never a spinner in the middle of the screen.
export function HomeSkeleton({ rows = SKELETON_ROWS }: { rows?: number }) {
    return (
        <View accessibilityLabel="Loading coworkers">
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
            <View style={{ position: 'absolute', left: HOME_GUTTER, top: SKELETON.avatarTop, width: AVATAR, height: AVATAR, borderRadius: radius.md, backgroundColor: theme.muted }} />
            <View style={{ position: 'absolute', left: SKELETON.textLeft, right: HOME_GUTTER, top: 0, bottom: 0 }}>
                <View style={{ position: 'absolute', top: SKELETON.nameTop, width: `${widths.name}%`, height: SKELETON.nameHeight, borderRadius: radius.sm, backgroundColor: theme.muted }} />
                <View style={{ position: 'absolute', top: SKELETON.statusTop, width: `${widths.status}%`, height: SKELETON.statusHeight, borderRadius: radius.sm, backgroundColor: theme.muted }} />
            </View>
        </View>
    )
}
