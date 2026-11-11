import { useRef, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import { Icon } from '@/components/ui/Icon'
import { UnreadDot } from '@/components/ui/UnreadDot'
import type { StatusLine } from '@/components/ui/status'
import * as Haptics from '@/lib/haptics'
import { useTimeAgo } from '@/lib/time'
import type { Coworker } from '@/mocks/data'
import { useTheme } from '@/theme/theme'
import { brand, spacing, withAlpha } from '@/theme/tokens'

export const AVATAR = 48
// The Home's side margin, its row title and the line under it, as Grok's sidebar draws them.
export const HOME_GUTTER = 20
export const ROW_TITLE = { fontSize: 19, lineHeight: 24 } as const
export const ROW_LINE = { fontSize: 17, lineHeight: 22 } as const
export const ROW_PADDING = 15
export const ROW_LINE_GAP = 4
// At the default text size: the padding around a name line, the gap and the status line under it.
export const COWORKER_ROW_HEIGHT = 2 * ROW_PADDING + ROW_TITLE.lineHeight + ROW_LINE_GAP + ROW_LINE.lineHeight
const PIN_ACTION_WIDTH = 96

export type PinControl = { pinned: boolean; onToggle: () => void }

type CoworkerRowProps = {
    coworker: Pick<Coworker, 'id' | 'kind' | 'name' | 'status'>
    line: StatusLine
    minutesAgo: number | null
    unread: boolean
    // The conversation open beside the list, on a wide window.
    selected?: boolean
    onPress: () => void
    // The finger lands before the tap ends: enough of a head start to read the conversation. Held
    // back a few frames so a scroll or a pin swipe starting on the row does not read anything.
    onPressIn?: () => void
    // A swipe to the left pins the row to the top of the list, or unpins it.
    pin?: PinControl
}

export function PinSwipe({ pin, children }: { pin: PinControl; children: ReactNode }) {
    const swipeable = useRef<SwipeableMethods>(null)
    const t = useTranslations('mobileHome')
    const label = pin.pinned ? t('row.unpin') : t('row.pin')

    const toggle = () => {
        Haptics.selectionAsync()
        swipeable.current?.close()
        pin.onToggle()
    }

    return (
        <ReanimatedSwipeable
            ref={swipeable}
            friction={2}
            rightThreshold={PIN_ACTION_WIDTH / 2}
            overshootRight={false}
            onSwipeableOpen={toggle}
            renderRightActions={() => (
                <Pressable onPress={() => swipeable.current?.close()} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: PIN_ACTION_WIDTH, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: brand.base }}>
                    <Icon name={pin.pinned ? 'pin-off' : 'pin'} size={18} bold color="#ffffff" />
                    <AppText variant="caption" medium maxFontSizeMultiplier={1.2} style={{ color: '#ffffff' }}>
                        {label}
                    </AppText>
                </Pressable>
            )}
        >
            {children}
        </ReanimatedSwipeable>
    )
}

export function CoworkerRow({ coworker, line, minutesAgo, unread, selected = false, onPress, onPressIn, pin }: CoworkerRowProps) {
    const theme = useTheme()
    const timeAgo = useTimeAgo()
    const t = useTranslations('mobileHome')
    const row = (
        <Pressable
            onPress={onPress}
            onPressIn={onPressIn}
            unstable_pressDelay={80}
            accessibilityRole="button"
            accessibilityLabel={line.text ? t('row.label', { name: coworker.name, line: line.text }) : coworker.name}
            accessibilityHint={t('row.opensConversation')}
            accessibilityActions={pin ? [{ name: 'togglePin', label: pin.pinned ? t('row.unpin') : t('row.pinToTop') }] : undefined}
            onAccessibilityAction={event => event.nativeEvent.actionName === 'togglePin' && pin?.onToggle()}
            // Opaque under the content: the pin action waits behind the row.
            style={selected ? { backgroundColor: theme.muted } : pin ? { backgroundColor: theme.background } : undefined}
            accessibilityState={{ selected }}
        >
            {({ pressed }) => (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: ROW_PADDING, paddingHorizontal: HOME_GUTTER, opacity: pressed ? 0.6 : 1 }}>
                    <CoworkerAvatar coworker={coworker} size={AVATAR} facing="right" />
                    <View style={{ flex: 1, gap: ROW_LINE_GAP }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
                            <AppText variant="headline" numberOfLines={1} maxFontSizeMultiplier={1.4} style={[ROW_TITLE, { flex: 1 }]}>
                                {coworker.name}
                            </AppText>
                            {minutesAgo !== null && (
                                <AppText variant="callout" maxFontSizeMultiplier={1.4} style={{ color: withAlpha(theme.mutedForeground, 0.6) }}>
                                    {timeAgo(minutesAgo)}
                                </AppText>
                            )}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                            <AppText variant="callout" tone={line.tone} numberOfLines={1} maxFontSizeMultiplier={1.4} style={[ROW_LINE, { flex: 1 }]}>
                                {line.text}
                            </AppText>
                            {unread && <UnreadDot />}
                        </View>
                    </View>
                </View>
            )}
        </Pressable>
    )
    return pin ? <PinSwipe pin={pin}>{row}</PinSwipe> : row
}
