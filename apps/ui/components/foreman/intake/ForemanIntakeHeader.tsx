'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'

import { Orb } from '@/components/foreman/Orb'
import { WELCOME_ORB_SIZE } from '@/components/foreman/constants'
import type { ForemanArrival } from '@/lib/foreman/phase'
import type { ForemanIntakeController } from './useForemanIntake'

/**
 * Ce que la colonne montre pendant que la carte d'accueil se remplit : l'orbe, la question, et la
 * ligne qui dit pourquoi on la pose. Le cadre en bas ne porte plus que les champs.
 *
 * Il prend la place de l'accueil habituel d'une conversation vide, et pas le dessus : l'orbe, le
 * titre et les suggestions de départ raconteraient la même chose une deuxième fois, au-dessus d'un
 * formulaire qui n'attend rien d'autre que d'être rempli.
 */

const EASE = [0.22, 1, 0.36, 1] as const

export function ForemanIntakeHeader({ intake, arrival = null }: { intake: ForemanIntakeController; arrival?: ForemanArrival | null }) {
    const t = useTranslations('foreman.intake')
    const still = useReducedMotion()

    const enter = (delay: number) => ({
        initial: still ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(8px)' },
        animate: still ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' },
        transition: still ? { duration: 0 } : { duration: 0.38, ease: EASE, delay },
    })

    return (
        // Collé au bas de la pile et non centré dedans : la question et le cadre qui y répond sont
        // une seule chose, et trente centimètres de vide entre les deux les séparaient en deux
        // écrans. Le haut de la colonne reste vide, c'est ce qui fait descendre le regard.
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center justify-end gap-5 px-8 pb-6 text-center">
            <motion.div {...enter(0)}>
                <Orb size={WELCOME_ORB_SIZE} state={intake.submitting || intake.deciding ? 'thinking' : 'listening'} />
            </motion.div>

            {/* Ce sur quoi ils ont cliqué avant d'arriver. Hors de l'`AnimatePresence` en dessous :
                cette ligne ne change pas d'une question à l'autre, et le bloc qui suit a une hauteur
                réservée que rien ne doit faire bouger entre deux étapes. */}
            {arrival && (
                <motion.p {...enter(0.04)} className="text-muted-foreground text-xs">
                    {t.rich('settingUp', { title: arrival.title, highlight: chunks => <span className="text-foreground">{chunks}</span> })}
                </motion.p>
            )}

            {/* La question change, l'orbe ne bouge pas : c'est la même personne qui pose les trois.
                D'où la hauteur réservée plutôt que laissée au texte : une description d'une ligne au
                lieu de deux remonterait l'orbe d'un cran entre deux questions. `popLayout` fait le
                reste, en évitant l'image où le bloc est vide et où tout retombe. */}
            <div className="grid min-h-[5.25rem] w-full max-w-[22rem] items-start">
                <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div key={intake.step} {...enter(0.08)} exit={still ? { opacity: 0 } : { opacity: 0, y: -8, filter: 'blur(6px)' }} className="col-start-1 row-start-1 space-y-1.5">
                        <h3 className="font-medium text-base">{t(`steps.${intake.step}.title`)}</h3>
                        <p className="text-muted-foreground text-sm">{t(`steps.${intake.step}.description`)}</p>
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    )
}
