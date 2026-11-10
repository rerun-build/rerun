import type { ReactNode } from 'react'
import type { BadgeTone } from '../primitives/badge'
import type { CanvasViewControlsPlacement } from '../CanvasViewControls'
import type { ContainerHandle, ContainerSide } from './iso'

// Types canoniques de l'isogrid. Le composant est *générique* : il ne connaît ni « agents » ni
// « spaces », seulement des Tiles (tuiles posées sur la grille) et des Containers (régions
// rectangulaires). Les apps consommatrices (ui, landing) gardent leur vocabulaire métier
// (agent/space) et mappent vers ces types via un petit adaptateur au moment du rendu.

export type GridPosition = { col: number; row: number }
export type WorldOffset = { left: number; top: number }

// 'select' : on sélectionne/déplace des tiles. 'draw' : on dessine un nouveau container.
export type InteractionMode = 'select' | 'draw'

// ---------------------------------------------------------------------------
// Style d'une tile
// ---------------------------------------------------------------------------
// Tout le rendu d'une tile est piloté par cette config. Un « preset » (cf. presets.ts) n'est
// qu'un TileStyle entièrement résolu. Les flags d'effets reproduisent le look agent historique.
export type TileStyle = {
    // Couleur de base des trois faces du bloc iso.
    color: string
    // Opacité globale du bloc (ex. 0.45 pour « offline »). Défaut: 1.
    opacity?: number
    // Couleur du halo (drop-shadow) quand la tile est levée (survol/sélection/ghost).
    glow?: string
    // Couleur des quatre murs de lumière d'une tile `highlighted`. Par défaut ils reprennent le
    // `glow`, ce qui ne tient que si celui-ci est une lumière : un glow qui joue le rôle d'une ombre
    // (tuile claire sur fond clair) doit poser cette couleur à part.
    haloColor?: string
    // 'theme' : le label, les arêtes et les rayures suivent le thème au lieu d'être blancs. Réservé
    // aux tuiles dont la face peut être claire, où de l'encre blanche disparaîtrait.
    ink?: 'theme'
    // Texte centré sur la face supérieure.
    label?: string
    // URL d'un logo affiché au centre de la face supérieure.
    image?: string
    // Filtre CSS appliqué au logo seul. Les previews l'utilisent uniquement pour les assets
    // automatiquement classés trop sombres pour leur tuile.
    imageFilter?: string
    // Épaisseur du bloc (hauteur des faces latérales) en px. Défaut: BLOCK_HEIGHT. Plus petit = plus plat.
    depth?: number
    // Effets optionnels (le preset agent les active selon le statut).
    shimmer?: boolean // sheen animé sur les faces (statut « working »)
    sheen?: boolean // reflet spéculaire STATIQUE sur la face du dessus (look métal) ; ≠ shimmer
    stripes?: boolean | 'hover' // rayures diagonales ; 'hover' = uniquement au survol/sélection
    errorPulse?: boolean // overlay rouge pulsant (statut « error »)
    pingRings?: boolean // anneaux cyan + halo (statut « waiting_human »)
    badge?: 'hand' | 'lock' | null // pictogramme au-dessus de la tile
    // État courant de la tile, écrit en clair. La couleur d'un bloc ne se devine pas : ce texte est
    // montré dans une pastille au survol, et `pinned` pose en plus une seconde ligne sous le
    // label, pour un état qui doit se lire sans rien survoler.
    status?: TileStatus
    // Something this tile is due to do, counted down above it where the hand and the lock sit. A
    // `badge` takes the spot when both are set.
    countdown?: TileCountdown
    // What it finished that you have not opened yet. Shares the countdown's pill, before the delay,
    // and the same rule: a `badge` takes the spot.
    results?: TileResults
    // Draws the tile as a buddy: a thick rounded block with a face, its top in the agent's colour,
    // its name in a frosted label. `true` takes every trait from the tile id; an object pins some.
    buddy?: true | BuddyLook
}

export type BuddyEyes =
    | 'pill'
    | 'round'
    | 'happy'
    | 'googly'
    | 'visor'
    | 'sleepy'
    | 'wink'
    | 'pixel'
    | 'star'
    | 'heart'
    | 'dot'
    | 'brows'
    | 'cyclops'
    | 'shades'
    | 'glasses'
    | 'sparkle'
    | 'line'

export type BuddyMouth = 'none' | 'smile' | 'open' | 'cat' | 'flat'

export type BuddyMood = 'idle' | 'working' | 'error' | 'waiting' | 'asleep'

// What makes one buddy look like itself. Anything left out is drawn from the tile id, so a board
// is varied without anyone choosing.
export type BuddyLook = {
    eyes?: BuddyEyes
    mouth?: BuddyMouth
    // Hex colour the agent wears while it rests.
    color?: string
    // Pins the mood. Left out, it is read from the tile's effects: an agent that is switched off or
    // offline has no effect to read it from, so its preset says it sleeps.
    mood?: BuddyMood
    // Share of its footprint's width the buddy fills, BUDDY_FOOTPRINT_SHARE when left out. The
    // floor shows around it for the rest.
    footprintShare?: number
}

export type TileCountdown = {
    // Epoch milliseconds.
    at: number
}

export type TileResults = {
    count: number
    // Newest first, one per conversation, every run of one scheduled task folded into one.
    items: TileResultItem[]
}

export type TileResultItem = {
    label: string
    count: number
    // Epoch milliseconds.
    at: number
}

// The status words of the presets, which the board reads in the reader's language. A label a caller
// writes itself (a paused workspace, a lab) has no key and shows as it is.
export type TileStatusLabelKey = 'idle' | 'working' | 'error' | 'offline' | 'waiting_human' | 'disabled' | 'paused' | 'restoring'

export type TileStatus = {
    label: string
    labelKey?: TileStatusLabelKey
    // Ton de la pastille de survol. À accorder à `TileStyle.color` : c'est ce qui relie la couleur
    // du bloc au mot qui la dit.
    tone: BadgeTone
    pinned?: TilePinnedStatus
}

export type TileStatusIcon = 'hand' | 'warning'

// La seconde ligne posée sous le label, sur la face de la tuile. Elle ne reprend pas forcément le
// mot du survol : la place manque, et un pictogramme suivi d'un nombre en dit plus long qu'une
// phrase tronquée.
export type TilePinnedStatus = {
    label?: string
    labelKey?: TileStatusLabelKey
    icon?: TileStatusIcon
    count?: number
    spinner?: boolean
}

export type Tile = {
    id: string
    position: GridPosition // ancre = cellule nord (coin haut) du footprint
    span?: number // footprint N×N de la tile (1, 2, 3…) ; défaut DEFAULT_SPAN (=2)
    containerId?: string // si défini, borne le drag/placement à l'intérieur de ce container
    style: TileStyle
    selectable?: boolean // gate la sélection ; défaut: true si onTileSelect fourni
    draggable?: boolean // gate le drag ; défaut: true si onTileMove fourni
    // Mise en avant : un halo de lumière respire autour du bloc, faces latérales comprises. La tile
    // garde sa couleur, sa hauteur et sa place — c'est une emphase, pas un statut, et elle est
    // indépendante de la sélection (une tile peut être les deux). Couleur = `style.glow`, sinon la
    // lumière neutre de la grille.
    highlighted?: boolean
    // Mise en retrait : la tile s'efface derrière ce que la scène met en avant, sans bouger ni
    // changer de couleur. Contraire de `highlighted`, et à ne pas confondre avec `style.opacity`,
    // qui dit un état de la tile elle-même (hors ligne) : celle-ci dit seulement qu'on regarde
    // ailleurs, et se rallume dès que ce n'est plus le cas. Les liens qui y touchent suivent.
    dimmed?: boolean
    // La tile vient d'apparaître sur la grille → joue l'animation d'atterrissage (fade + slide down)
    // une seule fois. L'hôte pose ce flag transitoirement puis le retire (cf. justPlacedAgentId).
    justPlaced?: boolean
    // Retarde l'atterrissage de cette tile (ms), pour poser un board en cascade plutôt que d'un
    // bloc. Sans effet tant que justPlaced n'est pas posé.
    dropDelay?: number
    // Nom accessible (lecteurs d'écran / focus clavier). Construit par l'app depuis son vocabulaire
    // métier (ex. « nom agent, statut »), car le package ignore la sémantique « agent ».
    ariaLabel?: string
}

// ---------------------------------------------------------------------------
// Container (région rectangulaire ; anciennement « Space »)
// ---------------------------------------------------------------------------
// 'placeholder' = bloc « fantôme » incitatif (pointillés animés, label central) pour un container
// qui n'existe pas encore. 'loading' = même fantôme mais en cours de création (spinner, non cliquable),
// le temps que l'espace réel soit inséré. Défaut: 'default'.
export type ContainerVariant = 'default' | 'placeholder' | 'loading'
export type ContainerDropStyle = 'fade' | 'draw'

export type Container = {
    id: string
    label: string | null
    color: string
    col_start: number
    row_start: number
    col_end: number
    row_end: number
    variant?: ContainerVariant
    // Texte affiché au centre du variant 'placeholder' (copie métier fournie par l'hôte).
    placeholderLabel?: string
    // Invitation posée au centre d'un container bien réel, qui garde son label, ses poignées et ses
    // « + » : le variant 'placeholder' les retire tous, il ne sert qu'à un container qui n'existe pas.
    cta?: string
    // Ce que ce `cta` donne à voir : la pastille fait défiler ces phrases au repos, et ne dit le
    // `cta` lui-même qu'au survol.
    ctaExamples?: string[]
    // The `cta` is there but closed to this viewer: the pill is muted, and its hover reads `cta`
    // (the reason, from the host) without the arrow of an action.
    ctaDisabled?: boolean
    // The viewer may look at this container, not change it: no resize handles, no grip to move it,
    // and no tile placed or dropped in it (see onTileMoveRefused).
    readOnly?: boolean
    // Nom accessible du container (lecteurs d'écran / focus clavier), fourni par l'app hôte.
    ariaLabel?: string
    // Mise en retrait du container entier, empreinte et label debout compris (cf. Tile.dimmed).
    dimmed?: boolean
    // Le container vient d'apparaître → joue son animation d'entrée une seule fois. Pendant d'un
    // Tile.justPlaced, mais l'empreinte ne tombe pas du ciel : elle se dessine sur place.
    justPlaced?: boolean
    // Retarde cette entrée (ms), pour poser plusieurs containers en cascade. Sans effet tant que
    // justPlaced n'est pas posé.
    dropDelay?: number
    // 'fade' (défaut) : l'empreinte s'ouvre depuis son centre. 'draw' : son contour se trace d'abord,
    // le sol et le label suivent — une scène scriptée qui doit donner à voir la création d'une Box.
    dropStyle?: ContainerDropStyle
    // Durée de cette entrée (ms). Défaut 380, la valeur du board réel, où une Box créée doit être là
    // tout de suite ; une scène qui raconte prend le temps qu'elle veut.
    dropDuration?: number
    // Le container est dessiné mais n'existe pas : son contour plein cède la place à un pointillé
    // qui défile, comme le fantôme d'un container qu'on n'a pas encore créé. Réservé aux aperçus,
    // où une empreinte rendue comme une vraie se lirait comme une région déjà montée.
    ghost?: boolean
}

// ---------------------------------------------------------------------------
// Liens & toasts (adressés par id de tile, même forme « fil » qu'avant)
// ---------------------------------------------------------------------------
// Lien entre deux tiles. 'beam' (défaut) = câble « circuit » animé (appel agent↔agent vivant).
// 'cable' = petit câble fin et discret, parcouru par une comète de courant intermittente
// (ex. tile service connectée à un agent).
// appearDelay retarde le tracé du câble (ms) : il se branche une fois sa tile posée, au lieu
// d'exister sous elle pendant qu'elle tombe encore.
// Un lien n'a pas de mise en retrait à lui : il prend celle de ses extrémités (cf. Tile.dimmed), un
// câble n'étant pas plus présent que le bout le plus effacé auquel il est branché.
// `color` force la teinte du lien. Par défaut un beam prend celle du container de sa source, ce qui
// le relie visuellement à la région d'où part l'appel ; une scène dont les containers sont tous
// blancs (le board du produit les rend ainsi) obtient alors un lien blanc sur fond blanc, et n'a
// aucun autre moyen de le rattraper.
export type TileLink = { source: string; target: string; variant?: 'beam' | 'cable'; appearDelay?: number; color?: string }

// Bulle affichée au-dessus d'une tile, comme un message entre deux collègues : le nom de celui qui
// parle, puis le message, et une pointe vers sa tuile. Le rendu et l'expiration vivent dans le package.
export type TileToast = {
    id: string
    tileId: string
    message: string
    author?: string
}

// ---------------------------------------------------------------------------
// Géométrie de container (dessin / resize)
// ---------------------------------------------------------------------------
export type ContainerRect = { colStart: number; rowStart: number; colEnd: number; rowEnd: number }
// Les 4 pointes (poignées de resize) et les 4 faces du losange : définies avec la géométrie, dans
// iso.ts, et réexportées ici pour que les consommateurs n'aient qu'une porte d'entrée.
export type { ContainerHandle, ContainerSide }
export type ResizePatch = Partial<Pick<Container, 'col_start' | 'row_start' | 'col_end' | 'row_end'>>
export type ContainerCellRect = Pick<Container, 'col_start' | 'row_start' | 'col_end' | 'row_end'>

// ---------------------------------------------------------------------------
// Caméra (cadrage de la vue)
// ---------------------------------------------------------------------------
export type IsoCamera = { pan: { x: number; y: number }; zoom: number }

// Ordre de centrer la vue sur une tile. `insetRight` (px écran) est la largeur que l'hôte recouvre
// sur le bord droit du canvas, un panneau latéral par exemple : la tile se centre dans ce qui reste
// visible, pas sous le panneau.
export type IsoFocusRequest = { tileId: string; nonce: number; insetRight?: number }

export type FrameInset = { left: number; right: number }

export type IsoGridProps = {
    // Data
    tiles: Tile[]
    containers: Container[]
    liveLinks?: TileLink[]
    // Toasts « vivants » ancrés au-dessus de leur tile. Le package gère l'animation et
    // l'auto-expiration (cf. onToastExpire) ; l'hôte se contente de pousser/purger la liste.
    toasts?: TileToast[]

    // État contrôlé par l'hôte
    selectedTileId?: string | null
    selectedContainerId?: string | null
    placingTileId?: string | null
    // Active le mode placement pour une nouvelle tile « draft » (pas encore créée, donc sans id).
    // Le placement est actif dès que placingTileId OU placing est défini.
    placing?: boolean
    // Look + footprint du ghost de placement d'un draft.
    placingTile?: { span?: number; style: TileStyle }
    // Restreint le placement à ce seul container : poser ailleurs est invalide (ghost rouge). Sert
    // à enchaîner plusieurs placements dans une même région. Défaut: null = n'importe quel container.
    placementContainerId?: string | null
    // Onboarding : borne le ghost de placement à l'intérieur du container cible (il ne peut pas en
    // sortir, reste donc toujours valide). Défaut: false = placement libre.
    clampPlacementToContainer?: boolean
    mode?: InteractionMode

    // Config (les défauts reproduisent le comportement de l'app UI)
    showLinks?: boolean
    worldAnchor?: { left: string; top: string }
    initialPan?: { x: number; y: number }
    initialZoomDesktop?: number
    initialZoomMobile?: number
    // Cadrage restauré par l'hôte (ex. localStorage). Prioritaire sur initialPan/initialZoom* et
    // neutralise l'ajustement mobile : c'est un cadrage choisi par l'utilisateur, pas un défaut.
    // Lu au montage seulement — pour recadrer ensuite, passer par `camera`.
    initialCamera?: IsoCamera | null
    // Cadrage **piloté** par l'hôte, relu à chaque changement de valeur : une scène qui change de
    // plan d'une étape à l'autre le fait par ici. Prioritaire sur initialCamera / initialPan /
    // initialZoom*, et comme eux il neutralise l'ajustement mobile et fitToContent — l'hôte possède
    // le cadrage, un ResizeObserver n'a pas à écraser son plan.
    //
    // Comparée par **valeur** (zoom, pan.x, pan.y) et non par identité : la recalculer à chaque
    // render ne déclenche rien. Le premier cadrage se pose sans transition. Le pan est borné à la
    // zone navigable comme tous les autres chemins de cadrage, le zoom ne l'est pas.
    //
    // Un recadrage manuel (bouton « recentrer ») n'est pas rattrapé tant que l'hôte n'envoie pas une
    // caméra différente, et onCameraChange n'émet pas ce que l'hôte vient lui-même de demander.
    camera?: IsoCamera | null
    // Durée (ms) du déplacement joué quand `camera` change. 0 = saut instantané. Ignorée sous
    // prefers-reduced-motion, où la caméra saute toujours. Défaut: 620.
    cameraTransitionMs?: number
    // Cadre le contenu sur la taille réelle du conteneur, au montage puis à chaque redimensionnement,
    // et plafonne le zoom à initialZoomDesktop. Défaut: false. Remplace initialPan/initialZoom* quand
    // le conteneur est fluide et qu'aucune valeur fixe ne peut convenir à toutes les largeurs.
    // Neutralisé par initialCamera et par camera, abandonné dès que l'utilisateur cadre lui-même. Le contenu qui
    // change ne redéclenche jamais l'ajustement : la caméra ne bouge que si le conteneur bouge.
    fitToContent?: boolean
    // Recadrage **demandé** par l'hôte : à chaque changement de valeur, la vue refait un
    // fit-to-content, exactement comme le bouton « recentrer ». Un ordre et non un état, donc un
    // compteur : deux demandes identiques doivent se jouer deux fois. La valeur au montage est
    // ignorée, elle écraserait le cadrage restauré par initialCamera.
    recenterSignal?: number
    // Bandes du cadre (px écran) que l'hôte recouvre de son propre calque : le cadrage
    // (recentrer, fitToContent) les laisse de côté et centre le contenu dans ce qui reste. Un
    // changement rejoue fitToContent, jamais un recentrage, qui reste un ordre de l'hôte.
    frameInset?: FrameInset
    // Centre la vue sur une tile, zoom relevé à initialZoomDesktop s'il était plus bas. Même contrat
    // que recenterSignal : un changement de `nonce` déclenche, la valeur au montage est ignorée. Une
    // tile absente ou non posée ne bouge rien.
    focusRequest?: IsoFocusRequest | null
    mask?: string | false
    drawColor?: string
    canDraw?: boolean
    className?: string
    // Fige toutes les animations du board. Pour un board que l'hôte sait couvert (panel plein écran,
    // dialog) ou non regardé (fenêtre sans focus) ; hors viewport et onglet caché, la grille se fige
    // déjà d'elle-même.
    paused?: boolean
    // Pan/zoom au scroll (molette/trackpad) + pan/pinch tactile. Défaut: true (comportement app UI).
    // Mettre à false pour que la page scrolle normalement par-dessus la grille.
    scrollGestures?: boolean
    // Aucun pan ni zoom, ni à la souris ni au doigt : la caméra n'appartient qu'à l'hôte. Implique
    // scrollGestures false.
    locked?: boolean
    // Affiche le bouton « Recentrer » (fit-to-content) dans le coin du canvas. Défaut: false, pour ne
    // pas polluer les usages read-only (fonds marketing, previews).
    showViewControls?: boolean
    // Le coin où la pill se pose. Séparé de `showViewControls`, qui commande aussi le serrage des
    // bornes de navigation sur le contenu et ne doit donc pas servir à la déplacer.
    viewControlsPlacement?: CanvasViewControlsPlacement
    viewControlsClassName?: string

    // Callbacks interactifs : leur présence active la feature ; les omettre = read-only
    onTileSelect?: (id: string | null) => void
    onContainerSelect?: (id: string | null) => void
    onConfirmPlacement?: (pos: GridPosition) => void
    // `containerId` is the container the tile landed in, which may not be the one it left.
    onTileMove?: (id: string, pos: GridPosition, containerId?: string) => void
    // A tile pulled while it is not draggable, or dropped in a `readOnly` container: it stays where
    // it was, and the host says why.
    onTileMoveRefused?: (id: string) => void
    onTileContextMenu?: (id: string, x: number, y: number) => void
    onResizeContainerLocal?: (id: string, patch: ResizePatch) => void
    onResizeContainerCommit?: (id: string) => void
    onResizingContainerChange?: (id: string | null) => void
    // Déplacement d'un container entier, pris par son sol (appui tenu au doigt). Appelé au drop
    // seulement, avec son rect d'arrivée, quand il ne chevauche ni un autre container ni une tile
    // qui n'est pas la sienne. Ses tiles bougent du même delta : l'hôte les translate lui-même, le
    // package ne fait que le montrer.
    onContainerMove?: (id: string, rect: ContainerCellRect) => void

    // Émissions vers les dialogs/menus possédés par l'app hôte
    onCreateContainerRequest?: (rect: ContainerRect) => void
    // Ajout d'un container voisin depuis une face du container survolé/sélectionné. Fournir ce
    // callback fait apparaître un « + » sur chacune des 4 faces.
    onContainerAdd?: (id: string, side: ContainerSide) => void
    // Rect que produirait un clic sur ce « + » : sert à en dessiner le fantôme au survol. L'hôte
    // possède la règle de placement (taille, gap, évitement), le package ne fait que la montrer.
    containerAddPreview?: (id: string, side: ContainerSide) => ContainerRect | null
    // Nom accessible des « + » (le package ignore le vocabulaire métier de l'hôte).
    containerAddLabel?: string
    onContainerContextMenu?: (id: string, x: number, y: number) => void

    // Pan/zoom courants à chaque changement. Appelé à haute fréquence pendant un geste : l'hôte doit
    // throttler et ne surtout pas déclencher de setState.
    onCameraChange?: (camera: IsoCamera) => void

    // Appelé quand un toast a fini son cycle (entrée → tenue → sortie) → l'hôte le retire de son état.
    onToastExpire?: (id: string) => void

    // Curseurs multijoueurs. Position monde (coords du calque transformé) du pointeur local à
    // chaque déplacement, null quand il quitte la grille → l'hôte diffuse via Realtime.
    onPointerWorldMove?: (world: { x: number; y: number } | null) => void
    // Overlay rendu DANS le calque monde transformé (donc soumis au pan/zoom). Reçoit le zoom
    // courant pour que l'hôte puisse contre-scaler ses éléments et garder une taille écran constante.
    worldOverlay?: (zoom: number) => ReactNode
}
