'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'

import { mentionMenuBox, useMentionAutocomplete, type MentionMenuBox } from '@/components/chat/MentionAutocomplete'
import { useMentionComputers } from '@/components/computers/useMentionComputers'
import { ForemanComposer, type ForemanComposerMentionProps, type ForemanComposerProps } from '@/components/foreman/ForemanComposer'
import { ForemanTrialGate } from '@rerun/cloud/billing.client'
import { useForemanMentionAgents } from '@/components/foreman/useForemanMentionAgents'
import type { TrialStep } from '@/lib/foreman/next-steps'
import { cn } from '@/lib/utils'

/**
 * Le pied de la colonne. Une question du Foreman attend dans la conversation, comme l'`ask_user`
 * d'un agent dans son panneau : le composer s'efface tant qu'elle est là et revient quand elle est
 * répondue. Il n'y a alors rien d'autre à faire que d'y répondre, et chaque widget porte sa propre
 * sortie (champ libre, Skip, « Not now ») pour que ça reste vrai.
 *
 * Une fois la carte d'essai posée, le composer ne revient plus jusqu'à ce que l'essai tourne : un
 * pied le remplace (`ForemanTrialGate`), sinon le Foreman, gratuit, répondrait à tout ce qui s'écrit.
 *
 * `ownEntry` : le composer reste sous le starter pack, pour qui sait déjà ce qu'il veut. Ce qui s'y
 * écrit répond à la carte (ForemanColumn choisit où ça part).
 */

// Le repli de hauteur de l'agent sheet, au chiffre près : les deux pieds de panneau doivent se lire
// pareil. `popLayout` est ce qui empêche le composer sortant et la carte entrante de se pousser.
const SLOT_MOTION = {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto' as const, opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
}

type ForemanComposerSlotProps = Omit<ForemanComposerProps, keyof ForemanComposerMentionProps> & {
    /** Une question attend dans la conversation : le pied ne porte plus rien. */
    aside: boolean
    /** La carte d'essai est posée et l'essai ne tourne pas encore : plus rien ne part. */
    trialGate: TrialStep | null
    /** Under a coworker's line and in its column, in the Simple view's middle. */
    framed?: boolean
    /** What waits on the user above the field, as a coworker's chat pins its skill proposals. */
    above?: ReactNode
    ref?: Ref<HTMLDivElement>
}

export function ForemanComposerSlot({ aside, trialGate, framed = false, above, ref, ownEntry = false, ...composer }: ForemanComposerSlotProps) {
    const bare = aside && !trialGate

    const { composerRef } = composer
    const mentionAgents = useForemanMentionAgents()
    // Picking a mention writes `el.value` directly, which fires no React change event.
    const syncComposer = useCallback((text: string) => composerRef.current?.sync(text), [composerRef])
    const mentionComputers = useMentionComputers()
    const { inputRef, menu: mentionMenu, tokens: mentionTokens, textareaProps: mentionTextareaProps } = useMentionAutocomplete(mentionAgents, [], syncComposer, mentionComputers.computers, mentionComputers.refresh)
    const composerShown = !trialGate && !aside

    // The composer folds inside an `overflow-hidden` box that would clip the menu, so the menu is
    // placed against the slot itself and sits on the field.
    const mentionMenuAnchorRef = useRef<HTMLDivElement>(null)
    const [mentionMenuPlace, setMentionMenuPlace] = useState<MentionMenuBox | null>(null)
    const mentionMenuOpen = mentionMenu !== null
    useLayoutEffect(() => {
        const root = mentionMenuAnchorRef.current?.offsetParent
        const input = inputRef.current
        if (!mentionMenuOpen || !root || !input) return
        setMentionMenuPlace(mentionMenuBox(input, root))
    }, [mentionMenuOpen, inputRef])

    return (
        // Docké ou flottant, le panneau est une carte à part entière : à partir de `md` le composer
        // y garde sous lui la même marge que sur les côtés.
        // Sous `md` le pied touche le bas de l'écran : il s'assoit sur la barre d'accueil. La
        // bannière cookies, quand elle est là, publie déjà un inset qui inclut la zone sûre, et le
        // panneau le porte, les deux ne s'additionnent donc pas.
        // Vide, il reste monté : c'est lui que la sheet mobile mesure, et il lui garde la zone sûre.
        <div
            ref={ref}
            className={cn(
                'relative z-10',
                framed ? cn('border-t border-border *:mx-auto *:max-w-[var(--chat-column,none)]', bare ? 'hidden' : 'p-3') : cn('px-3', bare ? 'pb-[env(safe-area-inset-bottom)] md:pb-0' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3')
            )}
        >
            <AnimatePresence initial={false} mode="popLayout">
                {trialGate ? (
                    <motion.div key="trial-gate" {...SLOT_MOTION} className="overflow-hidden">
                        <ForemanTrialGate step={trialGate} />
                    </motion.div>
                ) : null}
            </AnimatePresence>
            {/* Une seule instance, hors de la bascule ci-dessus : passer de la carte d'accueil au chat
                ne la remonte pas. Deux composers montés le temps d'une sortie se disputaient la ref du
                champ, et celui qui partait la remettait à null sous celui qui arrivait. */}
            {composerShown && above}
            <AnimatePresence initial={false} mode="popLayout">
                {composerShown && (
                    <motion.div key="composer" {...SLOT_MOTION} className="overflow-hidden pb-px">
                        <ForemanComposer {...composer} ownEntry={ownEntry} textareaRef={inputRef} textareaProps={mentionTextareaProps} mentionTokens={mentionTokens} />
                    </motion.div>
                )}
            </AnimatePresence>
            {mentionMenu && (
                <div ref={mentionMenuAnchorRef} className={cn('absolute', !mentionMenuPlace && 'invisible')} style={mentionMenuPlace ?? undefined}>
                    {mentionMenu}
                </div>
            )}
        </div>
    )
}
