import { formatElapsed, isSubRunFailing, isSubRunLive, isSubRunStalled, stripBridgePrefix, subRunOutcome, toolLabelOf, type SubRunCall, type SubRunTask } from '@rerun/contracts'
import { useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useTranslations } from 'use-intl'

import { Badge, TONES } from '@/components/ui/Badge'
import { AppText } from '@/components/ui/AppText'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Skeleton } from '@/components/ui/Skeleton'
import { useTheme } from '@/theme/theme'
import { layoutTransition, MOTION } from '@/theme/motion'
import { fonts, radius, spacing, withAlpha } from '@/theme/tokens'

type Tone = 'brand' | 'green' | 'red' | 'muted'

const VISIBLE_LIVE_CALLS = 3
const TRUNK_LEFT = 9
const INDENT = 24
const TASK_ROW_HEIGHT = 32
const STEP_ROW_HEIGHT = 24

// The tools a task's live line names with a verb ("Searching ..."), each one a key of `subRun.verbs`.
const STEP_VERBS = ['web_search', 'web_fetch', 'browser_navigate', 'shell_exec', 'fs_read', 'fs_write', 'fs_edit'] as const

type StepVerbTool = (typeof STEP_VERBS)[number]

const hasVerb = (tool: string): tool is StepVerbTool => (STEP_VERBS as readonly string[]).includes(tool)

const STEP_SYMBOLS: Record<string, IconName> = {
    web_search: 'search',
    web_fetch: 'file-text',
    browser_navigate: 'globe',
    shell_exec: 'terminal',
    fs_read: 'file-text',
    fs_write: 'square-pen',
    fs_edit: 'square-pen',
}

function toneOf(task: SubRunTask): Tone {
    if (task.status === 'running') return isSubRunFailing(task) ? 'red' : 'brand'
    if (task.status === 'done' || task.status === 'dispatched') return 'green'
    if (task.status === 'error') return 'red'
    return 'muted'
}

function useToneColor() {
    const theme = useTheme()
    return (tone: Tone) => (tone === 'muted' ? theme.border : withAlpha(TONES[tone][theme.scheme], 0.7))
}

const settledSeconds = (task: SubRunTask) => (task.startedAt === undefined || task.finishedAt === undefined ? undefined : Math.max(0, (task.finishedAt - task.startedAt) / 1000))

/** A delegation's tasks hanging from one trunk: the last calls of each while it works, its result once it settles. */
export function SubRunTree({ tasks, onStopTask }: { tasks: SubRunTask[]; onStopTask?: (taskId: string) => void }) {
    return (
        <View style={{ gap: spacing.xs }}>
            {tasks.map((task, i) => (
                <TaskBranch key={task.id ?? i} task={task} last={i === tasks.length - 1} onStop={onStopTask} />
            ))}
        </View>
    )
}

function Branch({ tone, last, children, elbowHeight = TASK_ROW_HEIGHT / 2 }: { tone: Tone; last: boolean; children: ReactNode; elbowHeight?: number }) {
    const colorOf = useToneColor()
    const color = colorOf(tone)
    return (
        <View style={{ paddingLeft: INDENT }}>
            {!last && <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: -spacing.xs, left: TRUNK_LEFT, borderLeftWidth: 1, borderColor: color }} />}
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: TRUNK_LEFT, width: 11, height: elbowHeight, borderLeftWidth: 1, borderBottomWidth: 1, borderBottomLeftRadius: 6, borderColor: color }} />
            {children}
        </View>
    )
}

function TaskStatus({ task }: { task: SubRunTask }) {
    const theme = useTheme()
    const glyph = (name: IconName, color: string) => <Icon name={name} size={16} color={color} />
    let node: ReactNode
    if (task.status === 'running') node = <ActivityIndicator size="small" color={TONES[isSubRunFailing(task) ? 'red' : 'brand'][theme.scheme]} style={{ transform: [{ scale: 0.8 }] }} />
    else if (task.status === 'error') node = glyph('circle-x-fill', TONES.red[theme.scheme])
    else if (task.status === 'stopped') node = glyph('circle-stop', theme.mutedForeground)
    else if (task.status === 'queued') node = glyph('clock', theme.mutedForeground)
    else node = glyph('circle-check-fill', TONES.green[theme.scheme])
    return <View style={{ width: 18, alignItems: 'center' }}>{node}</View>
}

function TaskBranch({ task, last, onStop }: { task: SubRunTask; last: boolean; onStop?: (taskId: string) => void }) {
    const t = useTranslations('mobileSteps.subRun')
    const theme = useTheme()
    const [open, setOpen] = useState(false)
    const [stopRequested, setStopRequested] = useState(false)
    const tone = toneOf(task)
    const running = task.status === 'running'
    const settled = !isSubRunLive(task)
    const expandable = settled && (!!task.calls?.length || !!task.preview)
    const seconds = settled ? settledSeconds(task) : undefined
    const idleMinutes = Math.floor((task.idleMs ?? 0) / 60_000)
    const expanded = open && expandable
    const canStop = !!onStop && !!task.id && running

    return (
        <Branch tone={tone} last={last}>
            <Pressable
                disabled={!expandable}
                onPress={() => setOpen(current => !current)}
                accessibilityRole={expandable ? 'button' : undefined}
                accessibilityState={expandable ? { expanded } : undefined}
                accessibilityLabel={task.title}
                style={({ pressed }) => ({ height: TASK_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.xs, borderRadius: radius.sm, backgroundColor: pressed ? theme.muted : 'transparent' })}
            >
                <TaskStatus task={task} />
                <AppText variant="footnote" medium tone={task.status === 'queued' ? 'muted' : 'default'} numberOfLines={1} style={{ flex: 1 }}>
                    {task.title}
                </AppText>
                {isSubRunFailing(task) && (
                    <View>
                        <Badge label={t('failures', { count: task.failures ?? 0 })} tone="red" size="xs" />
                    </View>
                )}
                {isSubRunStalled(task) && (
                    <View>
                        <Badge label={t('idle', { minutes: idleMinutes })} tone="orange" size="xs" />
                    </View>
                )}
                {seconds !== undefined && (
                    <AppText variant="caption" tone="muted" style={{ fontFamily: fonts.mono, fontVariant: ['tabular-nums'] }}>
                        {formatElapsed(seconds)}
                    </AppText>
                )}
                {expandable && <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={10} bold color={theme.mutedForeground} />}
                {canStop && (
                    <Pressable
                        disabled={stopRequested}
                        onPress={() => {
                            setStopRequested(true)
                            onStop(task.id!)
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t('stop')}
                        hitSlop={8}
                        style={({ pressed }) => ({ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, opacity: stopRequested ? 0.4 : 1, backgroundColor: pressed ? theme.muted : 'transparent' })}
                    >
                        <Icon name="stop-fill" size={11} color={theme.mutedForeground} />
                    </Pressable>
                )}
            </Pressable>

            {running && <LiveSteps task={task} tone={tone} />}
            {settled && !expanded && <Outcome task={task} />}

            {expanded && (
                <Animated.View entering={FadeIn.duration(MOTION.base)} style={{ gap: spacing.xs, paddingTop: 2, paddingBottom: spacing.xs }}>
                    {!!task.calls?.length && (
                        <View>
                            {task.calls.map((call, i) => (
                                <StepLine key={i} call={call} tone={tone} last={i === task.calls!.length - 1} />
                            ))}
                        </View>
                    )}
                    <Outcome task={task} />
                    {task.preview && (
                        <ScrollView nestedScrollEnabled style={{ maxHeight: 160, marginLeft: INDENT, borderRadius: radius.sm, borderCurve: 'continuous', backgroundColor: theme.muted }} contentContainerStyle={{ paddingHorizontal: spacing.md - 2, paddingVertical: spacing.sm }}>
                            <AppText variant="caption" selectable>
                                {task.preview}
                            </AppText>
                        </ScrollView>
                    )}
                </Animated.View>
            )}
        </Branch>
    )
}

function OutcomeLine({ symbol, size = 13, color, label }: { symbol: IconName; size?: number; color: string; label: string }) {
    return (
        <View style={{ minHeight: STEP_ROW_HEIGHT, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingLeft: 2, paddingVertical: 4 }}>
            <View style={{ width: 13, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={symbol} size={size} color={color} />
            </View>
            <AppText variant="caption" numberOfLines={2} style={{ flex: 1, color }}>
                {label}
            </AppText>
        </View>
    )
}

function Outcome({ task }: { task: SubRunTask }) {
    const t = useTranslations('mobileSteps.subRun')
    const theme = useTheme()
    if (task.status === 'done') {
        const result = subRunOutcome(task.preview)
        return result ? <OutcomeLine symbol="check" color={TONES.green[theme.scheme]} label={result} /> : null
    }
    if (task.status === 'error') return <OutcomeLine symbol="x" color={TONES.red[theme.scheme]} label={task.error || t('failed')} />
    if (task.status === 'stopped') return <OutcomeLine symbol="stop-fill" size={10} color={theme.mutedForeground} label={t('stopped')} />
    return null
}

function LiveSteps({ task, tone }: { task: SubRunTask; tone: Tone }) {
    const t = useTranslations('mobileSteps.subRun')
    const theme = useTheme()
    const calls: SubRunCall[] = task.calls?.length ? task.calls : task.activity ? [{ tool: task.activity, summary: '', elapsedMs: task.idleMs ?? 0 }] : []
    // The engine only keeps the last calls of a task, its count still has them all.
    const total = task.calls?.length ? Math.max(task.toolCalls ?? 0, calls.length) : calls.length
    const visible = calls.slice(-VISIBLE_LIVE_CALLS)
    const hidden = total - visible.length
    const inFlight = calls.some(call => call.elapsedMs !== undefined)

    return (
        <View>
            {hidden > 0 && (
                <AppText variant="caption" tone="muted" style={{ height: STEP_ROW_HEIGHT, lineHeight: STEP_ROW_HEIGHT, paddingLeft: INDENT, opacity: 0.7 }}>
                    {t('earlier', { count: hidden })}
                </AppText>
            )}
            {visible.map((call, i) => (
                <Animated.View key={total - visible.length + i} entering={FadeIn.duration(MOTION.base)} exiting={FadeOut.duration(MOTION.fast)} layout={layoutTransition}>
                    <StepLine call={call} tone={tone} last={inFlight && i === visible.length - 1} />
                </Animated.View>
            ))}
            {!inFlight && (
                <Animated.View entering={FadeIn.duration(MOTION.base)} style={{ opacity: 0.6 }}>
                    <Branch tone={tone} last elbowHeight={STEP_ROW_HEIGHT / 2}>
                        <View style={{ height: STEP_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                            <View style={{ width: 13, height: 13, borderRadius: 7, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.mutedForeground }} />
                            <Skeleton style={{ height: 8, width: 128, maxWidth: '60%', borderRadius: radius.pill }} />
                        </View>
                    </Branch>
                </Animated.View>
            )}
        </View>
    )
}

function Pulsing({ active, children }: { active: boolean; children: ReactNode }) {
    const reducedMotion = useReducedMotion()
    const opacity = useSharedValue(1)
    useEffect(() => {
        if (!active || reducedMotion) {
            opacity.value = 1
            return
        }
        opacity.value = withRepeat(withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true)
        return () => cancelAnimation(opacity)
    }, [active, opacity, reducedMotion])
    const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
    return <Animated.View style={[{ flex: 1, minWidth: 0 }, style]}>{children}</Animated.View>
}

function StepLine({ call, tone, last }: { call: SubRunCall; tone: Tone; last: boolean }) {
    const t = useTranslations('mobileSteps.subRun')
    const tTools = useTranslations('tools')
    const theme = useTheme()
    const tool = stripBridgePrefix(call.tool)
    const current = call.elapsedMs !== undefined
    const label = (hasVerb(tool) ? t(`verbs.${tool}`, { summary: call.summary }) : `${toolLabelOf(tool, undefined, tTools)} ${call.summary}`).trim()
    const color = call.failed ? TONES.red[theme.scheme] : current ? theme.foreground : theme.mutedForeground
    return (
        <Branch tone={call.failed ? 'red' : tone} last={last} elbowHeight={STEP_ROW_HEIGHT / 2}>
            <View style={{ height: STEP_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View style={{ width: 13, alignItems: 'center' }}>
                    <Icon name={call.failed ? 'x' : (STEP_SYMBOLS[tool] ?? 'settings')} size={12} color={call.failed ? color : theme.mutedForeground} />
                </View>
                <Pulsing active={current}>
                    <AppText variant="caption" numberOfLines={1} style={{ color }}>
                        {label}
                    </AppText>
                </Pulsing>
                {call.failed && (
                    <AppText variant="caption" style={{ color }}>
                        {t('failed')}
                    </AppText>
                )}
            </View>
        </Branch>
    )
}
