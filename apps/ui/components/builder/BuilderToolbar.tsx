'use client'

import { ClaimSpaceDialog } from '@/components/dialogs/ClaimSpaceDialog'
import { NewAgentDialog } from '@/components/dialogs/NewAgentDialog'
import { TemplateLibraryDialog } from '@/components/templates/TemplateLibraryDialog'
import { MyTemplatesDialog } from '@/components/templates/expert/MyTemplatesDialog'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { ChromeBar, ChromeButton, ChromeDivider } from '@rerun/ui/chrome'
import { Gauge } from '@/components/ui/gauge'
import { ToolbarDialogs } from '@/components/layout/ToolbarActions'
import { useIsTemplateAuthor } from '@/hooks/useIsTemplateAuthor'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { isPlaced } from '@/lib/board/iso'
import { useLibraryViewerSignals } from '@/lib/templates/useLibraryViewerSignals'
import { placementLabel, useBoardStore } from '@/stores/board.store'
import { useBuilderDialogsStore } from '@/stores/builder-dialogs.store'
import { useControlCenterStore } from '@/stores/control-center.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { CirclePlusIcon, GridIcon, PlusIcon, SearchIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

export function BuilderToolbar() {
    const t = useTranslations('builder.toolbar')
    const tCommon = useTranslations('common')
    const agents = useBoardStore(s => s.agents)
    const spaces = useBoardStore(s => s.spaces)
    const hydrated = useBoardStore(s => s.hydrated)
    const placingAgentId = useBoardStore(s => s.placingAgentId)
    const placement = useBoardStore(s => s.placement)
    const cancelPlacement = useBoardStore(s => s.cancelPlacement)
    const { libraryOpen, newAgentOpen, librarySlug, newBoxOpen, openLibrary, openNewAgent, setLibraryOpen, setNewAgentOpen, setNewBoxOpen } = useBuilderDialogsStore()
    const openControlCenter = useControlCenterStore(s => s.openControlCenter)
    const isTemplateAuthor = useIsTemplateAuthor()
    const { isAnonymous } = useSession()
    const viewerSignals = useLibraryViewerSignals()
    const { needsMachineReason } = useWorkspaceAccess()

    const unplacedAgents = agents.filter(a => !isPlaced(a.position))
    const placingFromQueue = !!placement && !placement.installing
    const placing = !!placingAgentId || placingFromQueue

    // Une template pose plusieurs agents à la suite : on nomme celui qu'on attend, et la jauge dit où
    // on en est du lot. Un agent seul n'a pas de progression à afficher.
    const placementPrompt = placement ? t('placementPrompt', { name: placementLabel(placement) }) : t('placementPromptDefault')
    const placementQueue = placement && placement.labels.length > 1 ? placement : null
    const placementProgressLabel = placementQueue ? t('placementProgress', { current: placementQueue.placed.length + 1, total: placementQueue.labels.length }) : ''

    // Pendant l'onboarding « recrute ton premier agent » (placeholder sur la grille), on masque les deux
    // boutons pour forcer le passage par le bloc fantôme ; le logout reste dans le switcher.
    const recruitingFirstAgent = hydrated && spaces.length === 0

    // Nothing in the bar is for an anonymous visitor: the sign-in pill in the top corner is their
    // only way in. The store-driven dialogs stay mounted.
    if (isAnonymous) return <ToolbarDialogs />

    const showBar = placing || !recruitingFirstAgent || unplacedAgents.length > 0

    const bar = (
        // Le bas n'est pas toujours le bas : la bannière cookies est `fixed bottom-0 z-60` en
        // mobile, donc la barre s'assoit sur l'inset qu'elle publie — sinon le prompt de placement
        // et son Cancel passent dessous pendant la toute première session.
        <ChromeBar className="absolute bottom-[calc(1rem+var(--consent-inset))] left-1/2 z-40 max-w-[calc(100%-2rem)] -translate-x-1/2">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {placing ? (
                    // En placement : la barre change entièrement de contenu (message shimmer + Cancel).
                    <div className="relative flex shrink-0 items-center gap-2 pl-3">
                        {placementQueue && (
                            <TooltipLabeled label={placementProgressLabel}>
                                <span className="flex items-center text-foreground" aria-label={placementProgressLabel}>
                                    <Gauge ratio={placementQueue.placed.length / placementQueue.labels.length} />
                                </span>
                            </TooltipLabeled>
                        )}
                        <Shimmer as="span" duration={1.6} className="text-sm font-medium whitespace-nowrap [--color-muted-foreground:#9ca3af] [--color-background:#ffffff]">
                            {placementPrompt}
                        </Shimmer>
                        <ChromeButton label={tCommon('cancel')} onClick={cancelPlacement} />
                    </div>
                ) : (
                    <>
                        {!recruitingFirstAgent && (
                            <>
                                <div className="hidden sm:contents">
                                    <ChromeButton icon={CirclePlusIcon} label={t('newCoworker')} disabledReason={needsMachineReason} onClick={openNewAgent} />
                                    <ChromeDivider />
                                    <ChromeButton icon={GridIcon} label={t('template')} disabledReason={needsMachineReason} onClick={() => openLibrary()} />
                                </div>
                                {/* Below `sm` the two labels crowd the notification bell: one "+" opens both choices. */}
                                <div className="flex shrink-0 sm:hidden">
                                    <DropdownMenu>
                                        <TooltipDisabledReason reason={needsMachineReason ?? undefined} side="top" className="rounded-full">
                                            <DropdownMenuTrigger asChild>
                                                <ChromeButton aria-label={t('create')} icon={PlusIcon} disabled={!!needsMachineReason} />
                                            </DropdownMenuTrigger>
                                        </TooltipDisabledReason>
                                        <DropdownMenuContent side="top" align="center" sideOffset={12}>
                                            <DropdownMenuItem onSelect={openNewAgent} className="gap-2 whitespace-nowrap">
                                                <CirclePlusIcon className="size-4" />
                                                {t('newCoworker')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => openLibrary()} className="gap-2 whitespace-nowrap">
                                                <GridIcon className="size-4" />
                                                {t('template')}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    <ChromeButton aria-label={t('search')} icon={SearchIcon} onClick={openControlCenter} />
                                </div>
                            </>
                        )}

                        {unplacedAgents.length > 0 && (
                            <>
                                {!recruitingFirstAgent && <ChromeDivider />}
                                <div className="relative flex h-(--chrome-control) shrink-0 items-center gap-1.5 px-1 md:pl-3">
                                    <span className="hidden text-xs text-muted-foreground md:inline">{t('unplaced', { count: unplacedAgents.length })}</span>
                                    {unplacedAgents.map(agent => (
                                        <button key={agent.id} className="flex h-6 items-center rounded-full bg-secondary px-2.5 text-xs whitespace-nowrap text-secondary-foreground transition-colors hover:bg-secondary/80" onClick={() => useBoardStore.setState({ placingAgentId: agent.id })}>
                                            {agent.name}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </ChromeBar>
    )

    return (
        <>
            {showBar && bar}
            {/* Dialogs montés en permanence (Radix les portale). Une Box, elle, se crée depuis une
                face d'une Box existante sur le board (cf. IsoBoard). */}
            <NewAgentDialog open={newAgentOpen} onOpenChange={setNewAgentOpen} onBrowseTemplates={openLibrary} />
            <TemplateLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} priorityCategory={viewerSignals.category} preferredConnectorSlugs={viewerSignals.connectorSlugs} initialSlug={librarySlug} onCreateFromScratch={openNewAgent} />
            <ClaimSpaceDialog target={null} open={newBoxOpen} onClose={() => setNewBoxOpen(false)} />
            {isTemplateAuthor && <MyTemplatesDialog />}
            <ToolbarDialogs />
        </>
    )
}
