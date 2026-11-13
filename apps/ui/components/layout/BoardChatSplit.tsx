'use client'

import { useReducedMotion } from 'motion/react'
import { type CSSProperties, useEffect, type ReactNode } from 'react'

import { ForemanColumn } from '@/components/foreman/ForemanColumn'
import { ForemanDropPreview } from '@/components/foreman/ForemanDropPreview'
import { ProviderStatusBanner } from '@/components/layout/ProviderStatusBanner'
import { useForemanInCenter } from '@/components/workspace-view/useForemanInCenter'
import { useWorkspaceView } from '@/components/workspace-view/WorkspaceViewProvider'
import { DEFAULT_FOREMAN_PLACEMENT, type ForemanPlacement, dockedForemanSide, loadForemanPlacement } from '@/lib/foreman-layout'
import { FOREMAN_COLUMN_QUERY, loadForemanOpen } from '@/lib/foreman-open'
import { useResolvedIsMobile } from '@rerun/ui/primitives'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { selectForemanVisible, useForemanStore } from '@/stores/foreman.store'

/**
 * Le cadre du dashboard : la carte du board et, docké à sa droite ou à sa gauche, le chat de l'orbe.
 * Docké, ouvrir le chat rétracte la carte au lieu de la recouvrir, et le chat se pose sur le frame,
 * hors de la carte — c'est ce qui distingue le Foreman de tout ce qui vit sur le board. Flottant, il
 * quitte la grille et se pose dans un coin, par-dessus la carte qui reprend toute la largeur.
 *
 * `initialOpen` est ce que le cookie disait : le serveur rend déjà la bonne colonne, sinon elle
 * s'ouvrirait en glissant à chaque chargement. `null` = aucune préférence connue, et là c'est le
 * défaut de l'écran qui parle — ouvert à partir de `md`, fermé en dessous, deux choses que les
 * classes de breakpoint savent servir en même temps sans rien mesurer.
 *
 * Un workspace sorti de l'onboarding sans machine n'a pas de Foreman : la colonne reste montée, c'est
 * elle qui relit la phase, mais elle ne prend ni piste ni place à l'écran.
 */
export function BoardChatSplit({ initialOpen, initialPlacement, children }: { initialOpen: boolean | null; initialPlacement: ForemanPlacement | null; children: ReactNode }) {
    const visible = useForemanStore(selectForemanVisible)
    const requested = useForemanStore(state => state.open)
    const resolved = requested ?? initialOpen
    // The Simple view, from `md`: the column takes the middle beside the list, and only while no coworker
    // is open there. Its place on the board is neither read nor written.
    const { view } = useWorkspaceView()
    const phone = useResolvedIsMobile(FOREMAN_COLUMN_QUERY)
    const simple = view === 'simple' && phone === false
    const inCenter = useForemanInCenter()
    const open = visible ? (simple ? inCenter : resolved) : false
    const chosenPlacement = useForemanStore(state => state.placement) ?? initialPlacement ?? DEFAULT_FOREMAN_PLACEMENT
    const placement: ForemanPlacement = simple ? { ...chosenPlacement, mode: 'dock', side: 'right' } : chosenPlacement
    const dragging = useForemanStore(state => state.dropTarget !== null)
    const docked = dockedForemanSide({ open, placement, dragging })
    const reduceMotion = useReducedMotion()
    const accountSwitches = useForemanStore(state => state.accountSwitches)
    const onboarded = useForemanStore(state => state.funnel === 'companion')

    // Le HTML du serveur est déjà peint quand l'hydratation démarre : rien ici ne peut arriver avant
    // le premier paint, c'est tout l'intérêt du cookie. Cet effet ne fait que trancher le `null` —
    // et refermer la colonne sur un téléphone, où elle est une sheet posée sur le board.
    useEffect(() => {
        useForemanStore.getState().restoreOpen(loadForemanOpen())
        useForemanStore.getState().restorePlacement(loadForemanPlacement())
    }, [])

    // Une sheet d'agent ouverte, d'où qu'elle vienne, efface la colonne le temps qu'elle reste là.
    // Sélectionner une Box n'ouvre plus de sheet : elle ne compte pas. Jamais pendant le tunnel : la colonne y mène, et la fermer devant la carte d'accueil
    // ferait surgir le mur de compte d'un anonyme (HomeContent).
    useEffect(() => {
        if (!visible) return
        return useBoardStore.subscribe((board, prev) => {
            const sheetOpen = board.selectedAgentId !== null
            const sheetWasOpen = prev.selectedAgentId !== null
            if (sheetOpen === sheetWasOpen) return
            const foreman = useForemanStore.getState()
            if (!sheetOpen) foreman.reclaimFromSheet()
            else if (foreman.open === true && foreman.funnel === 'companion') foreman.yieldToSheet()
        })
    }, [visible])

    return (
        // --board-inset : ce dont la carte est rentrée du bord de l'écran, son padding plus son bord.
        // Les couches `fixed` posées par-dessus (l'orbe) le rajoutent pour tomber au même écart du
        // bord visible que le mobilier qui, lui, est `absolute` dans la carte.
        // `relative` porte la sheet de la colonne sous `md`. Elle est `absolute` et non `fixed`
        // justement pour que l'`overflow-hidden` ci-dessous la découpe : repliée, elle est translatée
        // sous le bas de l'écran, et un `fixed` échapperait au découpage en ajoutant sa hauteur de
        // défilement au document.
        // --foreman-dock-track : la largeur tirée de la piste docké, bornée pour laisser sa part au
        // board quand l'écran rétrécit. La poignée du dock réécrit --foreman-dock-w ici pendant le geste.
        <div
            data-foreman-split
            style={{ '--foreman-dock-w': `${placement.dockWidth}px` } as CSSProperties}
            className={cn(
                'relative h-dvh w-full overflow-hidden p-0 md:p-2 bg-frame flex flex-col [--board-inset:0px] md:[--board-inset:9px]',
                // In the Simple view the list keeps its width (its sidebar's 288px, see SimpleWorkspace, and the
                // card's border) and the column takes the rest of the frame, its padding taken off.
                simple ? '[--simple-list-track:290px] [--foreman-dock-track:calc(100vw-1rem-var(--simple-list-track))]' : '[--foreman-dock-track:min(var(--foreman-dock-w),60vw)]'
            )}
        >
            {onboarded && <ProviderStatusBanner />}
            <div
                data-foreman-grid
                className={cn(
                    'grid flex-1 min-h-0 w-full grid-cols-1 grid-rows-[minmax(0,1fr)] duration-300 ease-in-out',
                    // Lu depuis le hook plutôt qu'écrit `motion-reduce:md:transition-none`, dont les deux
                    // variants ne se départagent que par l'ordre source.
                    visible && (reduceMotion ? 'md:transition-none' : 'md:transition-[grid-template-columns]'),
                    // Des pistes, jamais une custom property : sans `@property` une variable CSS n'est
                    // pas interpolée et la colonne sauterait au lieu de s'ouvrir. Toujours trois, une de
                    // chaque côté du board, pour que passer d'un dock à l'autre reste une interpolation.
                    // Foreman éteint, il n'y en a qu'une : le `grid-cols-1` de base tient le board seul.
                    visible &&
                        (docked === 'left'
                            ? 'md:grid-cols-[var(--foreman-dock-track)_minmax(0,1fr)_0px]'
                            : docked === 'right'
                              ? simple
                                  ? 'md:grid-cols-[0px_var(--simple-list-track)_var(--foreman-dock-track)]'
                                  : 'md:grid-cols-[0px_minmax(0,1fr)_var(--foreman-dock-track)]'
                              : 'md:grid-cols-[0px_minmax(0,1fr)_0px]')
                )}
            >
                <div className={cn('min-w-0 bg-background md:rounded-3xl md:border md:border-border md:shadow overflow-hidden md:overflow-auto h-full', visible && 'md:col-start-2 md:row-start-1')}>{children}</div>
                {/* Se connecter à un autre compte sans recharger repart d'une colonne neuve, qui relit
                    la phase et la conversation de ce compte-là. */}
                <div className={visible ? 'contents' : 'hidden'}>
                    <ForemanColumn key={accountSwitches} open={open} placement={placement} pinned={simple} />
                </div>
            </div>
            {visible && <ForemanDropPreview />}
        </div>
    )
}
