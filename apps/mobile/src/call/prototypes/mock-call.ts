import { useEffect, useRef, useState } from 'react'
import { Easing, cancelAnimation, useSharedValue, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated'

// Dev only: a scripted call that loops, so each prototype of the call screen can be judged moving,
// with no microphone, no hub and no voice.

export type MockPhase = 'ringing' | 'speaking' | 'listening' | 'thinking'

type Step = { phase: 'ringing'; ms: number } | { phase: 'speaking'; text: string } | { phase: 'listening'; text: string } | { phase: 'thinking'; tool: string; detail: string; ms: number }

export type MockLine = { who: 'coworker' | 'caller'; text: string }
export type MockTool = { label: string; detail: string; done: boolean }
export type MockEntry = { kind: 'line'; line: MockLine } | { kind: 'tool'; tool: MockTool }

export type MockCall = {
    phase: MockPhase
    // The line being said, by the coworker (`speaking`) or the caller (`listening`), and how many of its words are out.
    line: MockLine | null
    shownWords: number
    // What the coworker does between the caller's question and its answer, in the order it did it.
    tools: MockTool[]
    // Everything already said and done, oldest first.
    log: MockEntry[]
    pickedUpAt: number | null
    // 0 to 1: the loudness of whoever talks, or the breath of the call while it waits.
    level: SharedValue<number>
    interrupt: () => void
}

const SCRIPT: Step[] = [
    { phase: 'ringing', ms: 2800 },
    { phase: 'speaking', text: 'Hey, Scout here. What can I do for you?' },
    { phase: 'listening', text: 'Did Acme answer the proposal we sent on Monday?' },
    { phase: 'thinking', tool: 'Searching Gmail', detail: '"Acme proposal"', ms: 1900 },
    { phase: 'thinking', tool: 'Reading 3 emails', detail: 'Sarah Lee, Acme', ms: 1700 },
    { phase: 'speaking', text: 'Yes, Sarah answered this morning. The price works for them, but they want to start in January. Should I draft a reply?' },
    { phase: 'listening', text: 'Yes, keep it short and suggest a call next week.' },
    { phase: 'thinking', tool: 'Checking your calendar', detail: 'Next week', ms: 1500 },
    { phase: 'thinking', tool: 'Drafting the reply', detail: 'To Sarah Lee', ms: 1600 },
    { phase: 'speaking', text: 'Done. The draft is in Gmail, with Tuesday at ten as the call. Anything else?' },
]

const WORD_MS = { speaking: 270, listening: 230 }
const LINE_HOLD_MS = 650
const LEVEL_TICK_MS = 110
const BREATH = { duration: 900, easing: Easing.inOut(Easing.quad) }

function wordsOf(text: string): number {
    return text.split(' ').length
}

function stepLine(step: Step): MockLine | null {
    if (step.phase === 'speaking') return { who: 'coworker', text: step.text }
    if (step.phase === 'listening') return { who: 'caller', text: step.text }
    return null
}

function entryOf(step: Step): MockEntry[] {
    const line = stepLine(step)
    if (line) return [{ kind: 'line', line }]
    if (step.phase === 'thinking') return [{ kind: 'tool', tool: { label: step.tool, detail: step.detail, done: true } }]
    return []
}

type Cursor = { step: number; words: number; tools: MockTool[]; log: MockEntry[]; pickedUpAt: number | null }

function toolsBefore(step: number): MockTool[] {
    const tools: MockTool[] = []
    for (let index = step - 1; index >= 0 && SCRIPT[index].phase === 'thinking'; index--) {
        const done = SCRIPT[index]
        if (done.phase === 'thinking') tools.unshift({ label: done.tool, detail: done.detail, done: true })
    }
    return tools
}

// A still frame of the call: the first step in `phase`, with its line half said.
function frozenCursor(phase: MockPhase): Cursor {
    const step = Math.max(
        0,
        SCRIPT.findIndex((entry, index) => entry.phase === phase && index > 2),
    )
    const current = SCRIPT[step]
    const log = SCRIPT.slice(0, step).flatMap(entryOf)
    const line = stepLine(current)
    const tools = current.phase === 'thinking' ? [...toolsBefore(step), { label: current.tool, detail: current.detail, done: false }] : current.phase === 'speaking' ? toolsBefore(step) : []
    return { step, words: line ? Math.ceil(wordsOf(line.text) * 0.6) : 0, tools, log, pickedUpAt: phase === 'ringing' ? null : Date.now() - 74_000 }
}

const START: Cursor = { step: 0, words: 0, tools: [], log: [], pickedUpAt: null }

export function useMockCall(frozen: MockPhase | null): MockCall {
    const [cursor, setCursor] = useState<Cursor>(() => (frozen ? frozenCursor(frozen) : START))
    const level = useSharedValue(0)
    const step = SCRIPT[cursor.step]
    const line = stepLine(step)
    const cursorRef = useRef(cursor)
    useEffect(() => {
        cursorRef.current = cursor
    })

    useEffect(() => {
        if (frozen) return
        const advance = (current: Cursor): Cursor => {
            const now = SCRIPT[current.step]
            const next = (current.step + 1) % SCRIPT.length
            const log = [...current.log, ...entryOf(now)]
            if (next === 0) return START
            const upcoming = SCRIPT[next]
            const finishedTools = current.tools.map(tool => ({ ...tool, done: true }))
            const tools = upcoming.phase === 'thinking' ? [...finishedTools, { label: upcoming.tool, detail: upcoming.detail, done: false }] : upcoming.phase === 'listening' ? [] : finishedTools
            return { step: next, words: 0, tools, log, pickedUpAt: current.pickedUpAt ?? (upcoming.phase === 'speaking' ? Date.now() : null) }
        }
        const current = SCRIPT[cursor.step]
        if (current.phase === 'speaking' || current.phase === 'listening') {
            const said = cursor.words < wordsOf(current.text)
            const timer = setTimeout(() => (said ? setCursor(now => ({ ...now, words: now.words + 1 })) : setCursor(advance)), said ? WORD_MS[current.phase] : LINE_HOLD_MS)
            return () => clearTimeout(timer)
        }
        const timer = setTimeout(() => setCursor(advance), current.ms)
        return () => clearTimeout(timer)
    }, [cursor, frozen])

    const talking = step.phase === 'speaking' || step.phase === 'listening'
    useEffect(() => {
        if (!talking) {
            level.set(withRepeat(withSequence(withTiming(step.phase === 'ringing' ? 0.9 : 0.55, BREATH), withTiming(0.12, BREATH)), -1))
            return () => cancelAnimation(level)
        }
        const tick = setInterval(() => {
            const loudness = 0.25 + Math.random() * 0.75
            level.set(withTiming(loudness, { duration: LEVEL_TICK_MS }))
        }, LEVEL_TICK_MS)
        return () => clearInterval(tick)
    }, [talking, step.phase, level])

    const interrupt = () => {
        if (frozen || step.phase !== 'speaking') return
        const nextListening = SCRIPT.findIndex((entry, index) => index > cursorRef.current.step && entry.phase === 'listening')
        if (nextListening < 0) return
        setCursor(current => ({ ...current, step: nextListening, words: 0, tools: [], log: line ? [...current.log, { kind: 'line', line: { who: 'coworker', text: `${line.text.split(' ').slice(0, current.words).join(' ')}…` } }] : current.log }))
    }

    return { phase: step.phase, line, shownWords: cursor.words, tools: cursor.tools, log: cursor.log, pickedUpAt: cursor.pickedUpAt, level, interrupt }
}
