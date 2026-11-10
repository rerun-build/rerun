import { needsHuman, type Conversation, type SessionStatus } from '@rerun/contracts'
import { SymbolView } from 'expo-symbols'
import { useId } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Mask, Path, Pattern, Rect, Stop } from 'react-native-svg'

import { AppText } from '@/components/ui/AppText'
import { Badge, TONES } from '@/components/ui/Badge'
import { timeAgo } from '@/components/ui/status'
import { useTheme } from '@/theme/theme'
import { brand, fonts, radius, spacing, withAlpha } from '@/theme/tokens'

export type ThreadState = 'live' | 'needs' | 'error' | 'done'

export type ThreadItem = Pick<Conversation, 'title' | 'status' | 'source' | 'automationName' | 'outcome' | 'originAgentName'> & { id: string; createdAt: string; firstMessage?: string | null }

export function threadStateOf(status: SessionStatus): ThreadState {
    if (status === 'working') return 'live'
    if (status === 'error') return 'error'
    if (needsHuman(status)) return 'needs'
    return 'done'
}

const STATE_BADGE = { needs: { label: 'Needs you', tone: 'orange' }, error: { label: 'Error', tone: 'red' } } as const

const ROW_HEIGHT = 40
const CONNECTOR_INSET = 14

const isAutomated = (thread: ThreadItem) => thread.source === 'schedule' || thread.source === 'trigger'

// What stands in for the opening message when the hub never saw one: a run the engine started, a
// coworker's request, or a thread older than the column that keeps it.
function genericOpener(thread: ThreadItem): string {
    if (thread.source === 'schedule') return `Scheduled run · ${thread.automationName ?? thread.title}`
    if (thread.source === 'trigger') return `Webhook · ${thread.automationName ?? thread.title}`
    if (thread.source === 'agent' || thread.source === 'delegate') return `Asked by ${thread.originAgentName ?? 'another coworker'}`
    return 'Started a thread'
}

const minutesSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))

// The web's `Stripes fade="right"` turned half a turn: the hatch is strongest at the chevron and
// fades toward the title.
function Hatch() {
    const theme = useTheme()
    const id = useId().replace(/[^a-zA-Z0-9]/g, '')
    return (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
                <Pattern id={`${id}h`} width={6} height={6} patternUnits="userSpaceOnUse">
                    <Path d="M-1 1 L1 -1 M0 6 L6 0 M5 7 L7 5" stroke={withAlpha(theme.foreground, 0.1)} strokeWidth={1} />
                </Pattern>
                <LinearGradient id={`${id}f`} x1="0" y1="0" x2="1" y2="0">
                    <Stop offset={0} stopColor="#ffffff" stopOpacity={0} />
                    <Stop offset={1} stopColor="#ffffff" stopOpacity={1} />
                </LinearGradient>
                <Mask id={`${id}m`}>
                    <Rect width="100%" height="100%" fill={`url(#${id}f)`} />
                </Mask>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${id}h)`} mask={`url(#${id}m)`} />
        </Svg>
    )
}

/**
 * A thread in General, as the web's `ThreadBranch`: the message it opened with in a small bubble,
 * and under it the thread's row, joined by a curve whose tone says where the thread stands. The row
 * is hatched rather than filled, so it never reads as one more bubble; a tap opens the thread.
 */
export function ThreadBranch({ thread, onOpen }: { thread: ThreadItem; onOpen: () => void }) {
    const theme = useTheme()
    const state = threadStateOf(thread.status)
    const badge = state === 'needs' || state === 'error' ? STATE_BADGE[state] : null
    const opener = thread.firstMessage?.trim() || genericOpener(thread)
    const live = theme.scheme === 'dark' ? brand.soft : brand.base
    const branchTone = { live: withAlpha(live, 0.7), needs: withAlpha(TONES.orange[theme.scheme], 0.7), error: withAlpha(TONES.red[theme.scheme], 0.7), done: theme.border }[state]
    const titleColor = thread.outcome === 'failed' ? theme.destructive : thread.outcome === 'nothing' ? theme.mutedForeground : theme.foreground
    return (
        <View style={{ gap: spacing.sm }}>
            <View style={{ alignSelf: 'flex-start', maxWidth: '100%', borderRadius: radius.lg, borderBottomLeftRadius: 6, backgroundColor: theme.muted, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                <AppText variant="footnote" numberOfLines={2} style={[{ color: withAlpha(theme.foreground, 0.8), paddingRight: 2 }, !thread.firstMessage && { color: theme.mutedForeground, fontFamily: fonts.italic }]}>
                    {opener}
                </AppText>
            </View>
            <View style={{ paddingLeft: CONNECTOR_INSET * 2 }}>
                <View pointerEvents="none" style={{ position: 'absolute', top: -spacing.sm, left: CONNECTOR_INSET, width: 12, height: spacing.sm + ROW_HEIGHT / 2, borderLeftWidth: 1, borderBottomWidth: 1, borderBottomLeftRadius: 6, borderColor: branchTone }} />
                <Pressable
                    onPress={onOpen}
                    accessibilityRole="button"
                    accessibilityLabel={`Open thread ${thread.title}`}
                    style={({ pressed }) => ({ alignSelf: 'flex-start', maxWidth: '100%', height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm + 2, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', opacity: pressed ? 0.6 : 1 })}>
                    <Hatch />
                    {state === 'live' && <View accessibilityLabel="Running" style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: live }} />}
                    {isAutomated(thread) && <SymbolView name={thread.source === 'trigger' ? 'point.3.connected.trianglepath.dotted' : 'calendar.badge.clock'} size={13} tintColor={theme.mutedForeground} />}
                    <AppText variant="callout" medium numberOfLines={1} style={{ flexShrink: 1, color: titleColor }}>
                        {thread.title}
                    </AppText>
                    {badge && (
                        <View>
                            <Badge size="xs" tone={badge.tone} label={badge.label} />
                        </View>
                    )}
                    <AppText variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                        {timeAgo(minutesSince(thread.createdAt))}
                    </AppText>
                    <SymbolView name="chevron.right" size={11} weight="semibold" tintColor={theme.mutedForeground} />
                </Pressable>
            </View>
        </View>
    )
}
