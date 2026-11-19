'use client'

import { usePrefersReducedMotion } from '@moldwright/ui/iso-grid'
import { AnimatePresence, motion, type Transition } from 'motion/react'

import type { DiscoveriesState, DiscoveryEntry } from '@/lib/company/explore/findings'
import { DiscoveryCard } from './DiscoveryCard'
import { DiscoveryStack, type FindingEntry } from './DiscoveryStack'
import { DiscoveryStatusPill } from './DiscoveryStatusPill'
import { DiscoveryTeaser } from './DiscoveryTeaser'

type Subject = { name: string; domain: string }

const SPRING: Transition = { type: 'spring', stiffness: 260, damping: 24 }

const entryMotion = (still: boolean) =>
    still
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2 } }
        : {
              initial: { opacity: 0, y: 18, scale: 0.94, rotate: -1.5 },
              animate: { opacity: 1, y: 0, scale: 1, rotate: 0 },
              exit: { opacity: 0, scale: 0.96, filter: 'blur(4px)' },
              transition: SPRING,
          }

function EntryView({ entry, subject, still }: { entry: DiscoveryEntry; subject: Subject; still: boolean }) {
    return entry.type === 'teaser' ? <DiscoveryTeaser source={entry.source} subject={subject} /> : <DiscoveryCard finding={entry.finding} still={still} />
}

function Ticker({ entries, subject, still }: { entries: DiscoveryEntry[]; subject: Subject; still: boolean }) {
    const findings = entries.flatMap(entry => (entry.type === 'finding' ? [entry] : []))
    const latest = findings.length ? findings.reduce((last, entry) => (entry.arrival > last.arrival ? entry : last)) : entries.at(-1)
    return (
        <div className="w-full max-w-72">
            <AnimatePresence mode="popLayout" initial={false}>
                {latest && (
                    <motion.div key={latest.id} {...entryMotion(still)}>
                        <EntryView entry={latest} subject={subject} still={still} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

export function BoardDiscoveries({
    state,
    domain,
    compact = false,
    still: stillOverride,
}: {
    state: DiscoveriesState
    domain: string
    compact?: boolean
    still?: boolean
}) {
    const prefersStill = usePrefersReducedMotion()
    const still = stillOverride ?? prefersStill

    const sorted = [...state.entries].sort((a, b) => a.order - b.order)
    const cards = sorted.filter((entry): entry is FindingEntry => entry.type === 'finding')
    const brain = cards.find(entry => entry.finding.kind === 'brain')
    const flowing = sorted.filter(entry => entry !== brain)

    const identity = cards.find(entry => entry.finding.kind === 'identity')
    const name = identity?.finding.kind === 'identity' ? identity.finding.name : domain
    const subject = { name, domain }
    const digging = !state.ended && sorted.some(entry => entry.type === 'teaser')

    if (!sorted.length) return null

    return (
        <div className="pointer-events-none absolute inset-0 z-10">
            <div className="absolute inset-x-0 top-4 flex flex-col items-center gap-2 px-4">
                <DiscoveryStatusPill name={name} found={cards.length} digging={digging} />
                {compact && <Ticker entries={flowing} subject={subject} still={still} />}
            </div>

            {!compact && <DiscoveryStack entries={cards} still={still} className="absolute -bottom-2 -right-2 w-72" />}

            <AnimatePresence>
                {compact && brain && (
                    <motion.div key={brain.id} className="absolute inset-x-0 bottom-4 mx-auto max-w-72 px-4" {...entryMotion(still)}>
                        <DiscoveryCard finding={brain.finding} still={still} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
