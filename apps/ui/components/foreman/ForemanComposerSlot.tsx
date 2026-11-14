'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState, type Ref } from 'react'

import { useMentionAutocomplete } from '@/components/chat/MentionAutocomplete'
import { ForemanComposer, type ForemanComposerMentionProps, type ForemanComposerProps } from '@/components/foreman/ForemanComposer'
import { ForemanSignInLink } from '@/components/foreman/ForemanSignInLink'
import { ForemanSignupGate } from '@/components/foreman/ForemanSignupGate'
import { ForemanTrialGate } from '@rerun/cloud/billing.client'
import { useForemanMentionAgents } from '@/components/foreman/useForemanMentionAgents'
import { ForemanIntakeCard } from '@/components/foreman/intake/ForemanIntakeCard'
import type { ForemanIntakeController } from '@/components/foreman/intake/useForemanIntake'
import type { TrialStep } from '@/lib/foreman/next-steps'
import { cn } from '@/lib/utils'
import { useSession } from '@/supabase/session/SessionProvider'

const SLOT_MOTION = {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto' as const, opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
}

type ForemanComposerSlotProps = Omit<ForemanComposerProps, keyof ForemanComposerMentionProps> & {
    aside: boolean
    intake: ForemanIntakeController | null
    gated: boolean
    trialGate: TrialStep | null
    ref?: Ref<HTMLDivElement>
}

export function ForemanComposerSlot({ aside, intake, gated, trialGate, ref, ownEntry = false, ...composer }: ForemanComposerSlotProps) {
    const { isAnonymous } = useSession()
    const bare = aside && !intake && !gated && !trialGate

    const { composerRef } = composer
    const mentionAgents = useForemanMentionAgents()
    const syncComposer = useCallback((text: string) => composerRef.current?.sync(text), [composerRef])
    const { inputRef, menu: mentionMenu, tokens: mentionTokens, textareaProps: mentionTextareaProps } = useMentionAutocomplete(mentionAgents, [], syncComposer)
    const composerShown = intake ? ownEntry : !gated && !trialGate && !aside

    const mentionMenuAnchorRef = useRef<HTMLDivElement>(null)
    const [mentionMenuTop, setMentionMenuTop] = useState(0)
    const mentionMenuOpen = mentionMenu !== null
    useLayoutEffect(() => {
        const root = mentionMenuAnchorRef.current?.offsetParent
        const input = inputRef.current
        if (!mentionMenuOpen || !root || !input) return
        setMentionMenuTop(input.getBoundingClientRect().top - root.getBoundingClientRect().top)
    }, [mentionMenuOpen, inputRef])

    return (
        <div ref={ref} className={cn('relative z-10 px-3', bare ? 'pb-[env(safe-area-inset-bottom)] md:pb-0' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3')}>
            <AnimatePresence initial={false} mode="popLayout">
                {intake ? (
                    <motion.div key="intake" {...SLOT_MOTION} className="overflow-hidden">
                        <div className={cn('overflow-y-auto overscroll-contain', composerShown ? 'max-h-[calc(70svh-7.5rem)]' : 'max-h-[70svh]')}>
                            <ForemanIntakeCard intake={intake} />
                            {isAnonymous && (
                                <div className="pb-2">
                                    <ForemanSignInLink />
                                </div>
                            )}
                        </div>
                    </motion.div>
                ) : gated ? (
                    <motion.div key="gate" {...SLOT_MOTION} className="overflow-hidden">
                        <ForemanSignupGate />
                    </motion.div>
                ) : trialGate ? (
                    <motion.div key="trial-gate" {...SLOT_MOTION} className="overflow-hidden">
                        <ForemanTrialGate step={trialGate} />
                    </motion.div>
                ) : null}
            </AnimatePresence>
            <AnimatePresence initial={false} mode="popLayout">
                {composerShown && (
                    <motion.div key="composer" {...SLOT_MOTION} className="overflow-hidden pb-px">
                        <ForemanComposer {...composer} ownEntry={ownEntry} textareaRef={inputRef} textareaProps={mentionTextareaProps} mentionTokens={mentionTokens} />
                    </motion.div>
                )}
            </AnimatePresence>
            {mentionMenu && (
                <div ref={mentionMenuAnchorRef} className="absolute inset-x-3" style={{ top: mentionMenuTop }}>
                    {mentionMenu}
                </div>
            )}
        </div>
    )
}
