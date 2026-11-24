'use client'

import { StepTransition } from '@rerun/ui/steps'

import type { ChangelogEntryView } from '@/app/api/_actions/changelog.actions'
import { cn } from '@/lib/utils'

// Sous `sm` le cadre est une bottom sheet d'une seule colonne : le visuel passe au-dessus du texte
// au lieu de disparaître comme l'aside des autres dialogs, une annonce sans image ne dit rien.
export function ChangelogEntryVisual({ entry, direction }: { entry: ChangelogEntryView; direction: number }) {
    // Le visuel popup est composé au ratio de la colonne et la remplit. Une entrée qui n'en a pas
    // retombe sur un 16:9 (capture, GIF) : rogné, il perdrait le bout d'UI qu'il est là pour montrer.
    const fit = entry.imageFill ? 'object-cover' : 'object-contain'
    return (
        <div className="relative order-first aspect-[4/3] shrink-0 overflow-hidden border-b bg-muted/30 sm:order-none sm:aspect-auto sm:border-b-0 sm:border-s">
            <StepTransition stepKey={entry.id} direction={direction} className="absolute inset-0">
                {entry.imageUrl ? <img src={entry.imageUrl} alt={entry.imageAlt ?? ''} className={cn('size-full', fit, entry.imageDarkUrl && 'dark:hidden')} /> : null}
                {entry.imageDarkUrl ? <img src={entry.imageDarkUrl} alt={entry.imageAlt ?? ''} className={cn('hidden size-full dark:block', fit)} /> : null}
            </StepTransition>
        </div>
    )
}
