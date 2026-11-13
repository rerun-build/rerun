'use client'

import { useTranslations } from 'next-intl'
import { type PointerEvent, useState } from 'react'

import { AuthDialog } from '@/components/dialogs/AuthDialog'
import { ForemanTabs } from '@/components/foreman/ForemanTabs'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipLabeled } from '@/components/ui/tooltip'
import type { ForemanPlacement } from '@/lib/foreman-layout'
import { LogInIcon, PanelLeftIcon, PanelRightIcon, PictureInPicture2Icon, PlusIcon } from '@/lib/icons'
import { foremanOrbState, selectForemanOpen, useForemanStore } from '@/stores/foreman.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { type ForemanAnchor, ForemanHeaderBar } from '@rerun/ui/foreman'

type PositionChoice = ForemanAnchor

const POSITION_CHOICES = [
    { value: 'dock-left', labelKey: 'dockLeft', icon: PanelLeftIcon },
    { value: 'dock-right', labelKey: 'dockRight', icon: PanelRightIcon },
    { value: 'float', labelKey: 'float', icon: PictureInPicture2Icon },
] as const satisfies readonly { value: PositionChoice; labelKey: string; icon: unknown }[]

function positionChoiceOf(placement: ForemanPlacement): PositionChoice {
    return placement.mode === 'float' ? 'float' : `dock-${placement.side}`
}

/** Faire flotter depuis le menu pose la fenêtre en bas, du côté où elle était dockée. */
function placementFor(choice: PositionChoice, current: ForemanPlacement): ForemanPlacement {
    const size = { width: current.width, height: current.height, dockWidth: current.dockWidth }
    if (choice === 'dock-left') return { mode: 'dock', side: 'left', ...size }
    if (choice === 'dock-right') return { mode: 'dock', side: 'right', ...size }
    if (current.mode === 'float') return current
    return { mode: 'float', corner: current.side === 'left' ? 'bottom-left' : 'bottom-right', ...size }
}

/**
 * Posé par-dessus la pile, sur un voile flouté qui s'évanouit vers le bas plutôt qu'une barre
 * opaque : les vieux messages continuent de se dissoudre dessous, mais les contrôles se détachent.
 * Sous `md` elle est la poignée de la sheet : on la tire pour changer de hauteur ou la refermer, et
 * un tap sur le grabber bascule entre les deux crans. À partir de `md` c'est la poignée de la
 * colonne : on l'attrape pour la docker à gauche, à droite, ou la faire flotter dans un coin. Le
 * menu de position fait la même chose au clavier.
 */
export function ForemanHeader({
    placement,
    movable = true,
    onDragPointerDown,
    onToggleSheetDetent,
    onNewChat,
}: {
    placement: ForemanPlacement
    // False where its place is fixed (the Simple view's middle): no menu to move it.
    movable?: boolean
    onDragPointerDown: (event: PointerEvent<HTMLElement>) => void
    onToggleSheetDetent: () => void
    onNewChat: () => void
}) {
    const t = useTranslations('foreman.header')
    const close = useForemanStore(state => state.close)
    const open = useForemanStore(selectForemanOpen)
    const activity = useForemanStore(state => state.activity)
    // Repartir de zéro en plein tunnel jette la conversation guidée et ce que le Foreman y a appris.
    const guided = useForemanStore(state => state.funnel === 'guided')
    const intakeOpen = useForemanStore(state => state.intake)
    const { isAnonymous } = useSession()
    const [signInOpen, setSignInOpen] = useState(false)
    const choice = positionChoiceOf(placement)
    const ChoiceIcon = POSITION_CHOICES.find(option => option.value === choice)?.icon ?? PanelRightIcon

    return (
        <ForemanHeaderBar
            anchor={choice}
            orbState={foremanOrbState({ open, activity })}
            orbPaused={!open}
            orbHiddenOnSheet={intakeOpen}
            onClose={close}
            closeDisabledReason={guided ? t('closeDisabled') : undefined}
            onGutter
            onDragPointerDown={onDragPointerDown}
            onToggleSheetDetent={onToggleSheetDetent}
            actions={
                <>
                    {movable && (
                        <DropdownMenu>
                            <TooltipLabeled label={t('move')} side="bottom">
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" aria-label={t('moveChat')} className="max-md:hidden">
                                        <ChoiceIcon className="size-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                            </TooltipLabeled>
                            <DropdownMenuContent align="end" className="w-auto">
                                <DropdownMenuRadioGroup value={choice} onValueChange={value => useForemanStore.getState().setPlacement(placementFor(value as PositionChoice, placement))}>
                                    {POSITION_CHOICES.map(({ value, labelKey, icon: Icon }) => (
                                        <DropdownMenuRadioItem key={value} value={value}>
                                            <Icon />
                                            {t(`position.${labelKey}`)}
                                        </DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                    {/* Sous `md`, le tunnel masque la pastille Sign in du board : la sheet la recouvre. */}
                    {guided && isAnonymous && (
                        <>
                            <Button variant="outline" size="sm" className="md:hidden" onClick={() => setSignInOpen(true)}>
                                <LogInIcon />
                                {t('signIn')}
                            </Button>
                            <AuthDialog variant="signin" open={signInOpen} onOpenChange={setSignInOpen} />
                        </>
                    )}
                    {!guided && (
                        <Button size="sm" onClick={onNewChat}>
                            <PlusIcon />
                            {t('newTask')}
                        </Button>
                    )}
                </>
            }
            // Le tunnel guidé n'a qu'une conversation, pas de tabs.
            tabs={guided ? undefined : <ForemanTabs />}
        />
    )
}
