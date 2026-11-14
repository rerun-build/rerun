import { AGENT_SPAN, GRID_SIZE, TILE_H, TILE_W, agentTileStyle, connectorTileStyle, hashUnit } from '@rerun/ui/iso-grid'
import type { Container, GridPosition, RoutedLink, RoutedTile, Tile, TileLink } from '@rerun/ui/iso-grid'

import { containerFromSpace } from '@/lib/board/iso-adapter'
import { CABLE_DRAW_MS, routeAlone, routeBoard, routeHitsBox, routesCross, tileAxisBox } from '@/lib/board/iso-route'
import type { AxisRoute } from '@/lib/board/iso-route'
import type { SpacePublic } from '@/lib/board/types'

// Le board du décor d'auth : quatre boxes réparties dans le cadre, leurs agents, les outils
// auxquels chacun est branché, et le scénario qu'ils rejouent en boucle.
//
// Les deux sortes de liens ne racontent pas la même chose. Un `cable` est de la plomberie : il
// relie un agent à un connecteur, et rien d'autre — deux agents ne se branchent jamais l'un à
// l'autre par un câble. Il est posé une fois pour toutes et reste là, éteint ou non.
//
// Un `beam` est un événement, pas une installation : AuthStageBoard ne le monte que le temps qu'il
// a lieu. Il relie deux agents — une passe, ou une collaboration qui dure — mais aussi un agent à
// l'un de ses connecteurs, et il se superpose alors exactement au câble : le câble est le tuyau, le
// beam est l'appel qui y passe. C'est ce qui distingue à l'écran un agent qui ouvre Stripe d'un
// agent qui réfléchit.
//
// Ce qui se passe n'est pas tiré au sort. Le décor joue un SCRIPT : des fils de travail écrits à
// la main, chacun une petite chaîne plausible (un lead entre, un ticket devient un article, une
// facture coince) qui traverse plusieurs agents et parfois plusieurs boxes. Le module compile ces
// fils en une suite d'images datées, useStageScript ne fait que les rejouer. Un tirage aléatoire
// donnait des tuiles qui clignotent ; une chaîne écrite donne quelque chose qu'on peut suivre des
// yeux pendant qu'on remplit le formulaire.

// Served by the app itself, from apps/ui/public/services, filled by scripts/public-export/refresh-catalog.mjs.
const ICON_BASE = '/services'

// URLs relevées telles quelles dans `services.icon` en prod, comme le font déjà le board de
// /brand/ui/foundations et les stages OG. Le `?tone=dark` est la marque d'une icône qui se perdrait sur
// fond sombre : connectorTileStyle le lit et la passe en silhouette blanche.
//
// Le catalogue est exactement ce que le script utilise, et chaque outil n'apparaît qu'une fois sur
// tout le board : deux tuiles Gmail à deux coins du cadre donnaient l'impression d'un décor bouclé
// avec trois logos, alors que c'est justement le nombre d'outils différents qui raconte le produit.
const CONNECTORS = {
    ahrefs: { name: 'Ahrefs', icon: `${ICON_BASE}/ahrefs.png?v=1783946921645` },
    apollo: { name: 'Apollo', icon: `${ICON_BASE}/apollo.png?v=1781628422981&tone=dark` },
    clay: { name: 'Clay', icon: `${ICON_BASE}/clay.png?v=1781628421249` },
    gmail: { name: 'Gmail', icon: `${ICON_BASE}/gmail.svg?v=1784542934049` },
    'google-calendar': { name: 'Google Calendar', icon: `${ICON_BASE}/google-calendar.svg?v=1785513263907` },
    'google-docs': { name: 'Google Docs', icon: `${ICON_BASE}/google-docs.svg?v=1785513264564` },
    'google-sheets': { name: 'Google Sheets', icon: `${ICON_BASE}/google-sheets.svg?v=1785513263623` },
    hubspot: { name: 'HubSpot', icon: `${ICON_BASE}/hubspot.svg?v=1781610001204` },
    instagram: { name: 'Instagram', icon: `${ICON_BASE}/instagram.svg?v=1788341143609` },
    intercom: { name: 'Intercom', icon: `${ICON_BASE}/intercom.svg?v=1787908747442&tone=dark` },
    linear: { name: 'Linear', icon: `${ICON_BASE}/linear.svg?v=1784279892420` },
    linkedin: { name: 'LinkedIn', icon: `${ICON_BASE}/linkedin.svg?v=1787241159350` },
    notion: { name: 'Notion', icon: `${ICON_BASE}/notion.svg?v=1782197362992&tone=dark` },
    slack: { name: 'Slack', icon: `${ICON_BASE}/slack.png?v=1784305607775` },
    stripe: { name: 'Stripe', icon: `${ICON_BASE}/stripe.svg?v=1781006680237` },
    tiktok: { name: 'TikTok', icon: `${ICON_BASE}/tiktok.svg?v=1788341143888&tone=dark` },
    wordpress: { name: 'WordPress', icon: `${ICON_BASE}/wordpress.svg?v=1783956619179` },
    x: { name: 'X', icon: `${ICON_BASE}/x.svg?v=1784008396096&tone=dark` },
} satisfies Record<string, { name: string; icon: string; highlight?: boolean }>

// Les slugs sont fermés sur le catalogue ci-dessus : une coquille est une erreur de compilation,
// et non une tuile sans icône découverte sur la page de signup.
type ConnectorSlug = keyof typeof CONNECTORS

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------
// Seul le centre d'une box est écrit en pixels écran : c'est la seule unité dans laquelle on peut
// raisonner sur « laisse la colonne du formulaire libre » et « remplis les quatre coins ». Tout le
// reste — le carré de la box, ses agents, ses connecteurs — est posé en cellules, parce que c'est
// la grille qui décide de ce qui est carré, de ce qui se chevauche et de ce qui est aligné.
const HALF_W = TILE_W / 2
const HALF_H = TILE_H / 2
// IsoGrid ancre le monde sur la cellule au centre de la grille (cf. WORLD_OFFSET).
const WORLD_TOP = (GRID_SIZE / 2) * TILE_H

// Une box est un carré de cellules, et pas le rectangle serré autour de ses agents : c'est la forme
// qu'a un space dans le produit, et c'est ce qui laisse la place de poser les agents ailleurs qu'en
// file indienne.
const BOX_SPAN = 5
// Un connecteur se pose exactement à deux crans du carré, donc toujours avec une cellule vide entre
// la box et lui. À un cran il est collé au bord et se lit comme un morceau de la box.
const CONNECTOR_RING = 2
// Un connecteur reste à portée de son agent. À l'autre bout du carré, son câble traverserait la box
// de part en part et passerait sous les autres agents.
const CONNECTOR_REACH = 5
// Deux connecteurs voisins d'une seule cellule se lisent comme une seule tuile.
const CONNECTOR_SPACING = 2
// La colonne du formulaire : une tuile posée là serait entièrement mangée par le voile central, on
// n'y gagnerait qu'une icône fantôme derrière le champ « email ».
const CENTER_KEEPOUT = 150

// Le cadre déborde volontairement du viewport (cf. OVERSCAN dans AuthStageBoard) : les bords du
// contenu sont coupés, c'est ce qui permet de zoomer assez pour lire les tuiles. Un carré qui sort
// du cadre se lit comme un décor qui continue ; une icône de service tranchée en deux se lit comme
// un bug. Les connecteurs restent donc dans la bande que le cadrage garantit visible.
//
// Cette bande se déduit du reste : la largeur du contenu est fixée par les carrés seuls (les
// connecteurs, bornés ici, ne la débordent jamais), fitToContent la ramène dans le cadre
// débordant, et il n'en reste à l'écran que 1/OVERSCAN. À 4 carrés dans les coins il reste un peu
// plus de 430 px de part et d'autre du centre, dont on retranche la demi-largeur d'une tuile.
const CONNECTOR_KEEP_IN = { x: 400, y: 264 }

// Ancre de la cellule dont le bloc se dessine, au plus près, centré sur le point (x, y). Le centre
// visuel d'une tile de footprint `span` posée en (col,row) tombe en x = (col-row) * 28 + 28 et
// y = (col+row) * 14 - 168 + span * 14. col et row étant entiers, (col-row) et (col+row) ont la
// même parité : tous les points ne sont pas atteignables, on prend donc le plus proche.
function at(x: number, y: number, span: number): GridPosition {
    const u = Math.round(x / HALF_W - 1)
    const exact = (y + WORLD_TOP - span * HALF_H) / HALF_H
    let w = Math.round(exact)
    if ((u + w) % 2 !== 0) w += exact > w ? 1 : -1
    return { col: (u + w) / 2, row: (w - u) / 2 }
}

// Centre écran d'une cellule d'une seule case, pour la tenir hors de la colonne du formulaire et
// dans la bande visible.
const cellScreenX = (cell: GridPosition) => (cell.col - cell.row) * HALF_W + HALF_W
const cellScreenY = (cell: GridPosition) => (cell.col + cell.row) * HALF_H - WORLD_TOP + HALF_H

// Distance de Chebyshev d'une cellule à l'empreinte d'un bloc : 0 dedans, 1 collée au bord. Elle
// vaut pour le carré d'une box comme pour le 2x2 d'un agent, et c'est ce qui rend le voisinage
// symétrique : mesurée depuis la seule ancre, une cellule au sud-est passerait pour plus lointaine
// qu'elle ne l'est.
function blockDistance(anchor: GridPosition, span: number, cell: GridPosition) {
    const dc = Math.max(anchor.col - cell.col, 0, cell.col - (anchor.col + span - 1))
    const dr = Math.max(anchor.row - cell.row, 0, cell.row - (anchor.row + span - 1))
    return Math.max(dc, dr)
}

const chebyshev = (a: GridPosition, b: GridPosition) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))

// Le module est aussi évalué au rendu serveur : rien n'y est tiré au sort, un Math.random
// casserait l'hydratation. Les seuls tirages restants (hashUnit) sont des fonctions du nom de ce
// qu'on place, donc identiques des deux côtés.

// ---------------------------------------------------------------------------
// Le cast
// ---------------------------------------------------------------------------
// Les identifiants sont des constantes et non des chaînes en clair : le script les cite une
// vingtaine de fois, et une coquille y produirait un fil qui ne réveille personne, en silence.

const LEAD_SCRAPER = 'auth-lead-scraper'
const OUTREACH_WRITER = 'auth-outreach-writer'
const MEETING_BOOKER = 'auth-meeting-booker'
const TICKET_ROUTER = 'auth-ticket-router'
const INBOX_TRIAGE = 'auth-inbox-triage'
const SEO_ANALYST = 'auth-seo-analyst'
const BLOG_WRITER = 'auth-blog-writer'
const SOCIAL_EDITOR = 'auth-social-editor'
const INVOICE_CHASER = 'auth-invoice-chaser'
const CRM_ENRICHER = 'auth-crm-enricher'

type StageAgent = { id: string; name: string }
type StageBox = { id: string; name: string; x: number; y: number; layout: AgentLayout; turns: number; agents: StageAgent[] }

// Les quatre carrés sont posés à des distances inégales du centre et du bord : à (±320, ±170) ils
// dessinaient une grille 2x2, et le décor ressemblait à un tableau plutôt qu'à un espace de
// travail. Deux contraintes tiennent ce décentrage :
//
// - |x| - BOX_SPAN * HALF_W reste au-dessus de CENTER_KEEPOUT, sinon la colonne du formulaire
//   (max-w-sm, 384px) recouvre un carré ;
// - les deux paires de boxes en diagonale d'écran restent quasi alignées sur un axe iso, parce que
//   ce sont elles qui portent les passes inter-box : sur l'autre diagonale un lien long part en
//   coude géant jusqu'au bord du cadre.
const BOXES: StageBox[] = [
    {
        id: 'auth-box-growth',
        name: 'Growth',
        layout: 'wedge',
        turns: 3,
        x: -344,
        y: -186,
        agents: [
            { id: LEAD_SCRAPER, name: 'Lead Scraper' },
            { id: OUTREACH_WRITER, name: 'Outreach Writer' },
            { id: MEETING_BOOKER, name: 'Meeting Booker' },
        ],
    },
    {
        id: 'auth-box-support',
        name: 'Support',
        layout: 'iso-col',
        turns: 0,
        x: 306,
        y: -150,
        agents: [
            { id: TICKET_ROUTER, name: 'Ticket Router' },
            { id: INBOX_TRIAGE, name: 'Inbox Triage' },
        ],
    },
    {
        id: 'auth-box-content',
        name: 'Content',
        layout: 'stair',
        turns: 1,
        x: -298,
        y: 168,
        agents: [
            { id: SEO_ANALYST, name: 'SEO Analyst' },
            { id: BLOG_WRITER, name: 'Blog Writer' },
            { id: SOCIAL_EDITOR, name: 'Social Editor' },
        ],
    },
    {
        id: 'auth-box-revenue',
        name: 'Revenue',
        layout: 'abreast',
        turns: 1,
        x: 352,
        y: 132,
        agents: [
            { id: INVOICE_CHASER, name: 'Invoice Chaser' },
            { id: CRM_ENRICHER, name: 'CRM Enricher' },
        ],
    },
]

// ---------------------------------------------------------------------------
// Le scénario
// ---------------------------------------------------------------------------
// Un fil est une chaîne de pas : un agent, l'outil qu'il ouvre, le temps qu'il y passe. Quand le
// pas suivant change d'agent, le compilateur en fait une passe — et si les deux agents ne sont pas
// dans la même box, c'est un échange qui traverse le cadre.
//
// Un pas peut aussi être mené à deux (`with`) : les deux agents restent allumés ensemble, reliés par
// un beam, dix secondes ou plus. C'est le seul moment du cycle où le décor demande qu'on le regarde,
// et il y en a un dans chaque coin du cadre — deux traversent l'écran d'une box à l'autre.
//
// Les durées sont écrites en dur et non tirées : ce sont elles qui font qu'un statut tient assez
// longtemps pour être lu. Elles sont volontairement inégales d'un pas à l'autre, sinon les fils se
// synchronisent au bout de deux tours et le décor se met à battre la mesure.
//
// `at` étale les fils sur le cycle. Deux fils qui partagent un agent doivent l'utiliser à des
// moments disjoints — c'est la seule contrainte, et auth-stage-board.test.ts la vérifie.

type ScriptStep = {
    agent: string
    // L'outil que l'agent ouvre pendant ce pas. Sans outil il travaille sans rien allumer : c'est
    // ce qui reste quand il relit, résume, décide.
    tool?: ConnectorSlug
    hold: number
    // Le pas se termine sur une main tendue : l'agent s'arrête, sa tuile passe en attente, et il ne
    // repart qu'une fois ce temps écoulé.
    awaitHuman?: number
    // L'agent avec qui ce pas est mené. Les deux travaillent en même temps et le beam entre eux
    // reste allumé tout le pas — souvent d'une box à l'autre. C'est la seule chose du décor qu'on
    // regarde vraiment longtemps : elle dure donc au moins COLLAB_MIN_MS, là où une passe ne fait
    // que passer.
    with?: string
}

type ScriptThread = { id: string; at: number; steps: ScriptStep[] }

const THREADS: ScriptThread[] = [
    {
        // Un lead entre : Growth le trouve, le vérifie, écrit, fait relire le mail, cale le
        // rendez-vous, et Revenue le reprend de l'autre côté du cadre.
        id: 'lead',
        at: 0,
        steps: [
            { agent: LEAD_SCRAPER, tool: 'apollo', hold: 4200 },
            { agent: LEAD_SCRAPER, tool: 'linkedin', hold: 3600 },
            { agent: OUTREACH_WRITER, tool: 'gmail', hold: 4400, awaitHuman: 4600 },
            // Growth et Revenue calent le rendez-vous à deux, d'un bout à l'autre du cadre, avant
            // que le dossier ne bascule chez Revenue.
            { agent: MEETING_BOOKER, tool: 'google-calendar', hold: 11500, with: CRM_ENRICHER },
            { agent: CRM_ENRICHER, tool: 'clay', hold: 4000 },
            { agent: CRM_ENRICHER, tool: 'hubspot', hold: 3400 },
        ],
    },
    {
        // La question revient trop souvent : Support la trie, la cherche dans la doc, ouvre le
        // ticket, prévient l'équipe, et Content en fait un article.
        id: 'ticket',
        at: 2600,
        steps: [
            { agent: INBOX_TRIAGE, tool: 'intercom', hold: 3600 },
            { agent: INBOX_TRIAGE, tool: 'notion', hold: 3200 },
            { agent: TICKET_ROUTER, tool: 'linear', hold: 4200 },
            // Support et Content décident ensemble de ce qu'on en écrit : l'autre diagonale du
            // cadre s'allume.
            { agent: TICKET_ROUTER, tool: 'slack', hold: 10500, with: BLOG_WRITER },
            { agent: BLOG_WRITER, tool: 'google-docs', hold: 4400 },
        ],
    },
    {
        // Un paiement tombe, le CRM se met à jour derrière.
        id: 'paiement',
        at: 3000,
        steps: [
            { agent: INVOICE_CHASER, tool: 'stripe', hold: 4000 },
            { agent: CRM_ENRICHER, tool: 'clay', hold: 3600 },
        ],
    },
    {
        // La veille du matin : un mot-clé bouge, l'analyste propose un angle et attend que la
        // personne devant le formulaire le choisisse avant que le post parte.
        id: 'veille',
        at: 2000,
        steps: [
            { agent: SEO_ANALYST, tool: 'ahrefs', hold: 3800, awaitHuman: 4400 },
            { agent: SOCIAL_EDITOR, tool: 'x', hold: 3200 },
        ],
    },
    {
        // Le CRM repère un compte à relancer, la facture repart.
        id: 'relance',
        at: 12500,
        steps: [
            { agent: CRM_ENRICHER, tool: 'hubspot', hold: 3600 },
            { agent: INVOICE_CHASER, tool: 'stripe', hold: 3400 },
        ],
    },
    {
        // Content prend le sujet, l'écrit, attend le feu vert avant de publier, le décline sur les
        // réseaux, et Support récupère le lien pour ses réponses.
        id: 'article',
        at: 26000,
        steps: [
            { agent: SEO_ANALYST, tool: 'ahrefs', hold: 4200 },
            // Le plan de l'article se fait à deux dans la même box : une collaboration courte
            // distance, pour que le geste ne soit pas réservé aux longues traversées. Le pas n'ouvre
            // rien — ils décident, et le seul trait allumé est celui qui les relie.
            { agent: SEO_ANALYST, hold: 10000, with: BLOG_WRITER },
            { agent: BLOG_WRITER, tool: 'wordpress', hold: 4000, awaitHuman: 4200 },
            // Le même sujet repart sur les trois réseaux. L'agent ne passe la main à personne, il
            // change d'outil : ses trois câbles s'allument l'un après l'autre, et c'est le seul
            // endroit du décor où l'on voit un agent tenir plusieurs branchements.
            { agent: SOCIAL_EDITOR, tool: 'x', hold: 3400 },
            { agent: SOCIAL_EDITOR, tool: 'instagram', hold: 3000 },
            { agent: SOCIAL_EDITOR, tool: 'tiktok', hold: 3600 },
            { agent: INBOX_TRIAGE, tool: 'intercom', hold: 3600 },
        ],
    },
    {
        // Une facture coince : Revenue la retrouve dans le tableau des impayés, attend l'accord
        // avant de relancer, met le CRM à jour, et Growth recale un appel.
        id: 'facture',
        at: 29000,
        steps: [
            { agent: INVOICE_CHASER, tool: 'google-sheets', hold: 3200 },
            { agent: INVOICE_CHASER, tool: 'stripe', hold: 4200, awaitHuman: 4000 },
            { agent: CRM_ENRICHER, tool: 'hubspot', hold: 3400 },
            { agent: MEETING_BOOKER, tool: 'google-calendar', hold: 3600 },
        ],
    },
    {
        // Support poste la réponse dans le canal, l'inbox met la réponse type à jour.
        id: 'doc',
        at: 27000,
        steps: [
            { agent: TICKET_ROUTER, tool: 'slack', hold: 8400 },
            { agent: INBOX_TRIAGE, tool: 'notion', hold: 3600 },
        ],
    },
    {
        // Fin de journée : Support fait le point avec Content sur ce qui est remonté de la semaine.
        // Le fil existe surtout pour la fin du cycle, qui sans lui n'avait plus que deux tuiles
        // allumées pendant vingt secondes.
        id: 'bilan',
        at: 44000,
        steps: [
            { agent: TICKET_ROUTER, tool: 'linear', hold: 3400 },
            { agent: TICKET_ROUTER, hold: 11000, with: SEO_ANALYST },
            { agent: SEO_ANALYST, tool: 'ahrefs', hold: 3600 },
        ],
    },
    {
        // La séquence continue : deuxième touche sur les leads qui n'ont pas répondu.
        id: 'suite',
        at: 45000,
        steps: [
            { agent: LEAD_SCRAPER, tool: 'linkedin', hold: 9000 },
            { agent: OUTREACH_WRITER, tool: 'gmail', hold: 3400 },
        ],
    },
]

// La passe reste allumée après le départ : le destinataire se met au travail pendant qu'elle
// brille, sinon on voit un trait s'éteindre puis, une seconde plus tard, une tuile s'allumer, et le
// lien entre les deux se perd.
const HANDOFF_MS = 1500
const HANDOFF_LEAD = 500
// La reprise après un feu vert humain : l'agent finit son pas avant de passer la main, sinon
// l'attente se termine sur un fondu et on ne sait pas si quelqu'un a répondu.
const RESUME_MS = 1300
// Une collaboration doit tenir assez longtemps pour qu'on la remarque, qu'on suive le trait d'un
// bout à l'autre et qu'on comprenne que ces deux-là travaillent ensemble. Une passe s'attrape du
// coin de l'œil ; une collaboration se regarde.
const COLLAB_MIN_MS = 10_000
// Le cycle de statut est volontairement beaucoup plus lent que les appels d'outils : une tuile
// garde sa couleur entre 10 et 30 secondes, tandis que ses câbles peuvent continuer à raconter les
// étapes de son travail. La boucle laisse aussi sept secondes de calme après le dernier lien.
const CYCLE_PERIOD = 72_000

// ---------------------------------------------------------------------------
// Disposition des agents dans une box
// ---------------------------------------------------------------------------
// Les agents ne sont pas tirés au hasard dans le carré : chaque box nomme sa figure et son
// orientation. C'est ce qui rend chaque amas différent sans qu'aucun n'ait l'air jeté là — un
// tirage libre donne des paires collées et des paires aux deux bouts, et ça se voit.
//
// Le choix n'est pas non plus libre. Il décide de deux choses qu'on ne voit pas en le lisant : quel
// agent occupe la pointe de son carré, donc lequel se fait trancher par le bord du cadre, et à quel
// point les agents que le script fait dialoguer d'une box à l'autre restent alignés sur un axe iso,
// donc si leur passe est une droite ou un coude à travers l'écran. auth-stage-board.test.ts tient
// les deux.
//
// Les offsets sont des ancres de bloc 2x2 dans un carré de BOX_SPAN, donc bornés à BOX_SPAN - 2.
const LAYOUT_MAX = BOX_SPAN - AGENT_SPAN

const AGENT_LAYOUTS = {
    // alignés sur l'axe des colonnes : à l'écran, une diagonale vers le bas-droite
    'iso-col': [{ col: 0, row: 1 }, { col: 3, row: 1 }],
    // alignés sur l'axe des lignes : la diagonale opposée
    'iso-row': [{ col: 1, row: 0 }, { col: 1, row: 3 }],
    // l'un au-dessus de l'autre à l'écran
    stacked: [{ col: 0, row: 0 }, { col: 3, row: 3 }],
    // côte à côte à la même hauteur
    abreast: [{ col: 0, row: 3 }, { col: 3, row: 0 }],
    // trois agents en coin
    wedge: [{ col: 0, row: 0 }, { col: 3, row: 0 }, { col: 0, row: 3 }],
    // trois agents en marche d'escalier
    stair: [{ col: 0, row: 0 }, { col: 3, row: 1 }, { col: 0, row: 3 }],
    // deux agents côte à côte, le troisième en retrait au milieu
    fork: [{ col: 0, row: 0 }, { col: 2, row: 2 }, { col: 3, row: 0 }],
} satisfies Record<string, GridPosition[]>

type AgentLayout = keyof typeof AGENT_LAYOUTS

// Quart de tour du carré, appliqué à l'ancre d'un bloc : le catalogue reste court et chaque figure
// se présente sous quatre angles.
function turned(offset: GridPosition, turns: number): GridPosition {
    let { col, row } = offset
    for (let i = 0; i < turns; i++) {
        const next = { col: row, row: LAYOUT_MAX - col }
        col = next.col
        row = next.row
    }
    return { col, row }
}

type PlacedAgent = StageAgent & { cell: GridPosition; boxId: string }
type PlacedBox = { box: StageBox; anchor: GridPosition; agents: PlacedAgent[] }
type PlacedConnector = { id: string; agentId: string; slug: ConnectorSlug; cell: GridPosition }

const connectorId = (agent: string, slug: ConnectorSlug) => `${agent}::${slug}`

function placeBox(box: StageBox): PlacedBox {
    const anchor = at(box.x, box.y, BOX_SPAN)
    const layout = AGENT_LAYOUTS[box.layout]
    if (layout.length !== box.agents.length) throw new Error(`[auth-stage-board] la figure « ${box.layout} » ne pose pas ${box.agents.length} coworkers`)

    return {
        box,
        anchor,
        agents: box.agents.map((agent, index) => {
            const offset = turned(layout[index], box.turns)
            return { ...agent, boxId: box.id, cell: { col: anchor.col + offset.col, row: anchor.row + offset.row } }
        }),
    }
}

// ---------------------------------------------------------------------------
// Connecteurs
// ---------------------------------------------------------------------------
// Les outils d'un agent ne sont pas tirés : ce sont exactement ceux que le script lui fait ouvrir,
// dans l'ordre où il les ouvre. Aucune tuile ne reste éteinte pendant tout le cycle, et le nombre
// d'outils varie d'une box à l'autre parce que leurs fils n'ont pas la même longueur.
function toolsByAgent(): Map<string, ConnectorSlug[]> {
    const out = new Map<string, ConnectorSlug[]>()
    const seen = new Set<ConnectorSlug>()

    for (const thread of THREADS) {
        for (const step of thread.steps) {
            if (!step.tool || seen.has(step.tool)) continue
            seen.add(step.tool)
            out.set(step.agent, [...(out.get(step.agent) ?? []), step.tool])
        }
    }

    return out
}

// L'anneau où tombent les connecteurs d'une box : dehors, à exactement CONNECTOR_RING crans du
// carré, hors de la colonne du formulaire, et dans la bande que le cadrage laisse voir.
function ringAround(anchor: GridPosition): GridPosition[] {
    const out: GridPosition[] = []
    for (let col = anchor.col - CONNECTOR_RING; col <= anchor.col + BOX_SPAN - 1 + CONNECTOR_RING; col++) {
        for (let row = anchor.row - CONNECTOR_RING; row <= anchor.row + BOX_SPAN - 1 + CONNECTOR_RING; row++) {
            const cell = { col, row }
            if (blockDistance(anchor, BOX_SPAN, cell) !== CONNECTOR_RING) continue
            if (Math.abs(cellScreenX(cell)) < CENTER_KEEPOUT) continue
            if (Math.abs(cellScreenX(cell)) > CONNECTOR_KEEP_IN.x) continue
            if (Math.abs(cellScreenY(cell)) > CONNECTOR_KEEP_IN.y) continue
            out.push(cell)
        }
    }
    return out
}

// Ce qu'on est prêt à sacrifier, dans l'ordre. Un câble qui passe sous une tuile est le pire cas :
// il disparaît, et on ne comprend plus d'où il sort. Un croisement entre deux câbles est laid mais
// reste lisible. Un croisement avec une passe est presque invisible, elle n'est allumée qu'un
// instant.
const COST_UNDER_TILE = 1000
const COST_BLOCKS_CABLE = 1000
const COST_CROSSES_CABLE = 100
const COST_CROSSES_BEAM = 10

// Un câble garde l'identité de ses deux bouts : il touche forcément la face de l'agent dont il
// part et celle du connecteur où il arrive, et ces deux contacts ne sont pas des conflits.
type CableRoute = AxisRoute & { targetId: string }

type Obstacles = {
    tiles: { id: string; position: GridPosition; span: number }[]
    cables: CableRoute[]
    beams: AxisRoute[]
}

// The tiles already on the board as footprints the router keeps off, all but the ones a link joins.
const obstaclesBut = (world: Obstacles, ...ids: string[]) =>
    world.tiles.filter(tile => !ids.includes(tile.id)).map(tile => ({ col: tile.position.col, row: tile.position.row, span: tile.span }))

// How many cable conflicts (two crossing, one under a tile) the board has once its cables are routed
// together as TileLinks draws them, with `connector` and its cable added when given.
const conflictsOnBoard = (world: Obstacles, connector?: { tile: RoutedTile; agentId: string }) =>
    cableConflicts(
        connector ? [...world.tiles, connector.tile] : world.tiles,
        [
            ...world.cables.map(cable => ({ source: cable.sourceId, target: cable.targetId, variant: 'cable' as const })),
            ...(connector ? [{ source: connector.agentId, target: connector.tile.id, variant: 'cable' as const }] : []),
        ],
    ).length

const routeLength = (points: AxisRoute['points']) =>
    points.slice(1).reduce((total, point, index) => total + Math.abs(point.u - points[index].u) + Math.abs(point.v - points[index].v), 0)

// Le prix d'une cellule pour un connecteur : ce que son câble abîmerait s'il était posé là. Les
// deux tests de tuile sont symétriques — le câble candidat contre les tuiles déjà posées, et la
// tuile candidate contre les câbles déjà acceptés — sinon le dernier connecteur vient s'asseoir
// pile sur le câble du premier.
function placementCost(route: AxisRoute, cell: GridPosition, agent: PlacedAgent, world: Obstacles) {
    let cost = 0

    for (const tile of world.tiles) {
        if (tile.id === agent.id) continue
        if (routeHitsBox(route.points, tileAxisBox(tile))) cost += COST_UNDER_TILE
    }

    const candidateBox = tileAxisBox({ position: cell, span: 1 })
    for (const cable of world.cables) {
        if (routeHitsBox(cable.points, candidateBox)) cost += COST_BLOCKS_CABLE
        if (routesCross(route, cable)) cost += COST_CROSSES_CABLE
    }

    for (const beam of world.beams) {
        if (routesCross(route, beam)) cost += COST_CROSSES_BEAM
    }

    return cost
}

// Un connecteur tombe n'importe où sur l'anneau de sa box, pas dans le coin que sa fonction
// suggérerait : un outil se branche là où il y a de la place. `world` est global au board pour que
// deux boxes voisines ne se disputent jamais la même cellule ni le même couloir.
function placeConnectors(placed: PlacedBox, tools: Map<string, ConnectorSlug[]>, taken: GridPosition[], world: Obstacles): PlacedConnector[] {
    const ring = ringAround(placed.anchor)
    const out: PlacedConnector[] = []

    for (const agent of placed.agents) {
        for (const slug of tools.get(agent.id) ?? []) {
            const id = connectorId(agent.id, slug)

            // Ordre total et déterministe : hashUnit n'a que 10 000 seaux, sur une vingtaine de
            // candidats deux clés se répètent assez souvent pour qu'on dépende sinon de la
            // stabilité du tri.
            const free = ring
                .filter(cell => taken.every(other => chebyshev(other, cell) >= CONNECTOR_SPACING))
                .filter(cell => world.tiles.every(tile => blockDistance(tile.position, tile.span, cell) >= 1))
                .sort((a, b) => {
                    const delta = hashUnit(`${id}@${a.col},${a.row}`, 41) - hashUnit(`${id}@${b.col},${b.row}`, 41)
                    return delta !== 0 ? delta : a.col - b.col || a.row - b.row
                })
            const candidates = free.filter(cell => blockDistance(agent.cell, AGENT_SPAN, cell) <= CONNECTOR_REACH)
            // Within reach first; when every cell there damages something, the rest of the ring before
            // settling for the least damage.
            const pool = candidates.length > 0 ? [...candidates, ...free.filter(cell => !candidates.includes(cell))] : ring

            let best: { cell: GridPosition; route: CableRoute; score: number } | null = null
            let conflictsBefore: number | undefined

            for (const cell of pool) {
                const route: CableRoute = {
                    points: routeAlone({ id: agent.id, position: agent.cell, span: AGENT_SPAN }, { id, position: cell, span: 1 }, obstaclesBut(world, agent.id)),
                    sourceId: agent.id,
                    targetId: id,
                }
                // The estimate routes the cable alone. A cell that could still win is checked on the
                // board as drawn, every cable placed so far routed together with this one, and charged
                // for the conflicts it adds there.
                let cost = placementCost(route, cell, agent, world)
                if (best !== null && cost * 64 + routeLength(route.points) >= best.score) continue
                const added = conflictsOnBoard(world, { tile: { id, position: cell, span: 1 }, agentId: agent.id }) - (conflictsBefore ??= conflictsOnBoard(world))
                if (added > 0) cost += COST_CROSSES_CABLE * added
                // À prix égal, le câble le plus court gagne.
                const score = cost * 64 + routeLength(route.points)
                if (best === null || score < best.score) best = { cell, route, score }
                // Une cellule qui n'abîme rien est prise sans regarder la suite.
                if (cost === 0) break
            }

            if (best === null) continue

            taken.push(best.cell)
            world.tiles.push({ id, position: best.cell, span: 1 })
            world.cables.push(best.route)
            out.push({ id, agentId: agent.id, slug, cell: best.cell })
        }
    }

    return out
}

// ---------------------------------------------------------------------------
// Cascade d'entrée
// ---------------------------------------------------------------------------
// Le board se pose en deux vagues : les agents l'un après l'autre, puis les connecteurs, chacun
// suivi de son câble qui se branche. Mêmes valeurs que le board des templates, pour que les deux
// surfaces arrivent au même rythme. Le jitter est déterministe (hashUnit), pas Math.random : le
// module tourne aussi au rendu serveur.
const AGENT_STEP = 110
const CONNECTOR_GAP = 220
const CONNECTOR_STEP = 80
const CONNECTOR_JITTER = 70
const CABLE_LAG = 380
// Le dernier câble finit juste avant la fin de la chute de son connecteur. On laisse donc encore
// un vrai silence après son branchement : le dernier bloc a le temps de toucher le sol, puis le
// plateau respire avant que le premier agent ne se mette au travail.
const STAGE_SETTLE_MS = 900

// L'identité d'un lien telle que TileLinks la reconstruit, pour qu'un appelant puisse en désigner un.
export function stageLinkId(source: string, target: string) {
    return `${source}->${target}`
}

// ---------------------------------------------------------------------------
// Ce que le script produit
// ---------------------------------------------------------------------------
// Une image : tout ce qui change à un instant donné. Les changements sont groupés par date pour que
// le lecteur n'ait qu'un rendu à faire quand trois agents bougent ensemble.

export type StageStatus = 'working' | 'waiting_human' | 'idle'
// Les liens que l'agent allume à cet instant, et non un seul : pendant une collaboration il tient à
// la fois l'appel vers son outil et le beam vers son binôme.
// Statut et liens sont indépendants : un agent garde le même statut pendant qu'il change d'outil.
export type StageChange = { agent: string; status?: StageStatus; links?: string[] }
export type StageFrame = { at: number; changes: StageChange[] }
export type StageScript = {
    frames: StageFrame[]
    // La boucle : le cycle entier rejoué à l'identique, après un silence.
    period: number
    // Le décor finit d'atterrir avant que le scénario ne commence : un agent ne peut pas allumer un
    // câble encore rentré.
    startAt: number
}

// Le space est le carré de la box, tel quel : il ne se resserre pas sur ses agents, sinon deux
// agents tirés côte à côte donneraient une box deux fois plus petite que sa voisine.
const space = (id: string, name: string, anchor: GridPosition): SpacePublic => ({
    id,
    workspace_id: 1,
    name,
    col_start: anchor.col,
    row_start: anchor.row,
    col_end: anchor.col + BOX_SPAN - 1,
    row_end: anchor.row + BOX_SPAN - 1,
    created_at: null,
})

export type AuthStage = {
    tiles: Tile[]
    links: TileLink[]
    containers: Container[]
    agentIds: string[]
    dropDelays: Map<string, number>
    appearDelays: Map<string, number>
    script: StageScript
}

// Les liens agent→agent que le script réclame, dédoublonnés : les passes et les collaborations.
// Deux fils qui font le même relais partagent le même beam, et une collaboration suivie de sa passe
// n'en allume qu'un seul, celui-là même, du début de leur travail commun à la fin du relais.
function agentBeamPairs(): { source: string; target: string }[] {
    const seen = new Set<string>()
    const out: { source: string; target: string }[] = []

    const add = (source: string, target: string) => {
        if (source === target) return
        const key = stageLinkId(source, target)
        if (seen.has(key)) return
        seen.add(key)
        out.push({ source, target })
    }

    for (const thread of THREADS) {
        thread.steps.forEach((step, index) => {
            if (step.with) add(step.agent, step.with)
            const next = thread.steps[index + 1]
            if (next) add(step.agent, next.agent)
        })
    }

    return out
}

// Ce qu'un fil ne dit pas de lui-même et qu'on ne voit pas en le relisant. Comme assertNoOverlap,
// ces vérifications ne dépendent que du module : une erreur casse au premier import, en test comme
// au build, jamais devant un visiteur.
function assertThreadsAreSound(cast: Set<string>) {
    for (const thread of THREADS) {
        for (const step of thread.steps) {
            if (!cast.has(step.agent)) throw new Error(`[auth-stage-board] « ${thread.id} » réveille ${step.agent}, absent du cast`)
            if (!step.with) continue
            if (!cast.has(step.with)) throw new Error(`[auth-stage-board] « ${thread.id} » fait collaborer ${step.agent} avec ${step.with}, absent du cast`)
            if (step.with === step.agent) throw new Error(`[auth-stage-board] « ${thread.id} » fait collaborer ${step.agent} avec lui-même`)
            if (step.hold < COLLAB_MIN_MS)
                throw new Error(`[auth-stage-board] la collaboration ${step.agent} + ${step.with} de « ${thread.id} » ne tient que ${step.hold}ms`)
            // Une main tendue arrête son agent : le binôme resterait allumé au bout d'un beam que
            // plus personne ne tire.
            if (step.awaitHuman) throw new Error(`[auth-stage-board] la collaboration ${step.agent} + ${step.with} de « ${thread.id} » attend aussi un humain`)
        }
    }
}

// Le fil déroulé en images datées. Un pas allume l'outil de son agent ; un feu vert attendu le met
// en `waiting_human` puis le fait repartir ; un changement d'agent allume la passe, réveille le
// destinataire pendant qu'elle brille, et éteint l'émetteur derrière.
type DatedChange = StageChange & { at: number }
// Le temps pendant lequel un fil tient un agent, de son premier pas à la fin de sa passe. Deux fils
// qui se recouvrent sur le même agent produisent une tuile qui s'éteint au milieu d'un pas, et une
// passe tirée par quelqu'un qui ne travaille plus.
type AgentSpan = { thread: string; agent: string; from: number; to: number }

function compileThread(thread: ScriptThread, cableOf: (agent: string, tool: ConnectorSlug) => string | null): { changes: DatedChange[]; spans: AgentSpan[] } {
    const changes: DatedChange[] = []
    const spans: AgentSpan[] = []
    let t = thread.at
    let openedAt = t

    thread.steps.forEach((step, index) => {
        const startedAt = t
        const cable = step.tool ? cableOf(step.agent, step.tool) : null
        const collab = step.with ? stageLinkId(step.agent, step.with) : null
        const lit = [cable, collab].filter((id): id is string => id !== null)
        if (index === 0 || thread.steps[index - 1].agent !== step.agent) openedAt = t

        changes.push({ at: t, agent: step.agent, status: 'working', links: lit })
        // Le binôme se met au travail avec lui, sur le même beam : c'est le lien qui porte la
        // collaboration, aucun des deux ne le tient tout seul.
        if (step.with && collab) changes.push({ at: t, agent: step.with, status: 'working', links: [collab] })
        t += step.hold

        if (step.awaitHuman) {
            changes.push({ at: t, agent: step.agent, status: 'waiting_human', links: [] })
            t += step.awaitHuman
            changes.push({ at: t, agent: step.agent, status: 'working', links: lit })
            t += RESUME_MS
        }

        const next = thread.steps[index + 1]

        if (step.with) {
            // Un binôme qui reprend le fil derrière ne s'éteint pas : sa tuile clignoterait entre le
            // travail commun et son propre pas, à un demi-battement d'intervalle.
            if (next?.agent !== step.with) changes.push({ at: t, agent: step.with, status: 'idle', links: [] })
            spans.push({ thread: thread.id, agent: step.with, from: startedAt, to: t })
        }

        if (!next) {
            changes.push({ at: t, agent: step.agent, status: 'idle', links: [] })
            spans.push({ thread: thread.id, agent: step.agent, from: openedAt, to: t })
            return
        }
        if (next.agent === step.agent) return

        // Après une collaboration, la passe se fait sur le beam déjà allumé : le trait ne s'éteint
        // pas pour se rallumer, il reste tendu jusqu'à ce que l'émetteur lâche.
        changes.push({ at: t, agent: step.agent, status: 'working', links: [stageLinkId(step.agent, next.agent)] })
        changes.push({ at: t + HANDOFF_MS, agent: step.agent, status: 'idle', links: [] })
        spans.push({ thread: thread.id, agent: step.agent, from: openedAt, to: t + HANDOFF_MS })
        t += HANDOFF_LEAD
    })

    return { changes, spans }
}

// Deux fils qui se relaient sur le même agent ne se touchent pas non plus : à la milliseconde près,
// l'un l'éteint pendant que l'autre l'allume, et c'est l'ordre d'écriture des fils qui décide lequel
// gagne. Le fil suivant repart donc franchement après le précédent.
const SPAN_GAP_MS = 500

// Les appels d'outils gardent leur tempo propre, mais les couleurs des tuiles suivent cette
// partition lente. À l'ouverture, Growth part seul, puis Content et Support se réveillent avec des
// intervalles irréguliers ; le quatrième agent n'arrive qu'avec la première passe. On évite ainsi le
// « hop » de plusieurs tuiles qui passaient toutes en working sur la même image. Après cela chaque
// plage dure de 10 à 30 secondes, y compris au raccord entre deux cycles.
const STATUS_CHANGES: DatedChange[] = [
    { at: 2_200, agent: SEO_ANALYST, status: 'working' },
    { at: 12_200, agent: SEO_ANALYST, status: 'waiting_human' },
    { at: 24_200, agent: SEO_ANALYST, status: 'working' },
    { at: 36_200, agent: SEO_ANALYST, status: 'idle' },
    { at: 60_200, agent: SEO_ANALYST, status: 'working' },

    { at: 0, agent: LEAD_SCRAPER, status: 'working' },
    { at: 12_000, agent: LEAD_SCRAPER, status: 'idle' },
    { at: 38_000, agent: LEAD_SCRAPER, status: 'working' },
    { at: 50_000, agent: LEAD_SCRAPER, status: 'idle' },

    { at: 4_800, agent: INBOX_TRIAGE, status: 'working' },
    { at: 16_800, agent: INBOX_TRIAGE, status: 'idle' },
    { at: 37_800, agent: INBOX_TRIAGE, status: 'working' },
    { at: 49_800, agent: INBOX_TRIAGE, status: 'idle' },
    { at: 69_800, agent: INBOX_TRIAGE, status: 'working' },

    { at: 8_000, agent: OUTREACH_WRITER, status: 'working' },
    { at: 20_000, agent: OUTREACH_WRITER, status: 'idle' },
    { at: 32_000, agent: OUTREACH_WRITER, status: 'working' },
    { at: 44_000, agent: OUTREACH_WRITER, status: 'waiting_human' },
    { at: 56_000, agent: OUTREACH_WRITER, status: 'working' },
    { at: 68_000, agent: OUTREACH_WRITER, status: 'idle' },

    { at: 12_000, agent: TICKET_ROUTER, status: 'working' },
    { at: 24_000, agent: TICKET_ROUTER, status: 'idle' },
    { at: 48_000, agent: TICKET_ROUTER, status: 'working' },
    { at: 60_000, agent: TICKET_ROUTER, status: 'idle' },

    { at: 0, agent: INVOICE_CHASER, status: 'idle' },
    { at: 12_000, agent: INVOICE_CHASER, status: 'working' },
    { at: 24_000, agent: INVOICE_CHASER, status: 'idle' },
    { at: 40_000, agent: INVOICE_CHASER, status: 'working' },
    { at: 50_000, agent: INVOICE_CHASER, status: 'waiting_human' },
    { at: 62_000, agent: INVOICE_CHASER, status: 'working' },

    { at: 14_000, agent: CRM_ENRICHER, status: 'working' },
    { at: 26_000, agent: CRM_ENRICHER, status: 'idle' },
    { at: 50_000, agent: CRM_ENRICHER, status: 'working' },
    { at: 62_000, agent: CRM_ENRICHER, status: 'idle' },

    { at: 0, agent: BLOG_WRITER, status: 'idle' },
    { at: 16_000, agent: BLOG_WRITER, status: 'working' },
    { at: 28_000, agent: BLOG_WRITER, status: 'idle' },
    { at: 42_000, agent: BLOG_WRITER, status: 'working' },
    { at: 52_000, agent: BLOG_WRITER, status: 'waiting_human' },
    { at: 62_000, agent: BLOG_WRITER, status: 'working' },

    { at: 18_000, agent: SOCIAL_EDITOR, status: 'working' },
    { at: 30_000, agent: SOCIAL_EDITOR, status: 'idle' },
    { at: 54_000, agent: SOCIAL_EDITOR, status: 'working' },
    { at: 66_000, agent: SOCIAL_EDITOR, status: 'idle' },

    { at: 20_000, agent: MEETING_BOOKER, status: 'working' },
    { at: 34_000, agent: MEETING_BOOKER, status: 'idle' },
    { at: 60_000, agent: MEETING_BOOKER, status: 'working' },
    { at: 70_000, agent: MEETING_BOOKER, status: 'idle' },
]

// La seule contrainte que l'écriture d'un fil doit respecter, et celle qu'on ne voit pas en le
// relisant : deux fils ne tiennent jamais le même agent en même temps. Le calcul ne dépend que des
// constantes du module, donc un décalage fautif casse au premier import — en test comme au build,
// jamais devant un visiteur.
function assertNoOverlap(spans: AgentSpan[]) {
    const byAgent = new Map<string, AgentSpan[]>()
    for (const span of spans) byAgent.set(span.agent, [...(byAgent.get(span.agent) ?? []), span])

    for (const [agent, own] of byAgent) {
        const sorted = [...own].sort((a, b) => a.from - b.from)
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].from >= sorted[i - 1].to + SPAN_GAP_MS) continue
            throw new Error(`[auth-stage-board] ${agent} est tenu par « ${sorted[i - 1].thread} » et « ${sorted[i].thread} » en même temps`)
        }
    }
}

export function buildAuthStage(): AuthStage {
    const tiles: Tile[] = []
    const links: TileLink[] = []
    const containers: Container[] = []
    const agentIds: string[] = []
    const dropDelays = new Map<string, number>()
    const appearDelays = new Map<string, number>()

    const boxes = BOXES.map(placeBox)
    const allAgents = boxes.flatMap(placed => placed.agents)

    // Les agents et les liens qu'ils se tirent sont posés d'abord : ce sont les obstacles que les
    // câbles devront éviter, et ils sont entièrement déterminés dès que les agents ont leur cellule.
    const world: Obstacles = {
        tiles: allAgents.map(agent => ({ id: agent.id, position: agent.cell, span: AGENT_SPAN })),
        cables: [],
        beams: [],
    }

    const cellOf = new Map(allAgents.map(agent => [agent.id, agent.cell]))
    assertThreadsAreSound(new Set(cellOf.keys()))
    const agentBeams = agentBeamPairs()

    for (const beam of agentBeams) {
        world.beams.push({
            points: routeAlone(
                { id: beam.source, position: cellOf.get(beam.source)!, span: AGENT_SPAN },
                { id: beam.target, position: cellOf.get(beam.target)!, span: AGENT_SPAN },
                obstaclesBut(world, beam.source, beam.target),
            ),
            sourceId: beam.source,
        })
    }

    const tools = toolsByAgent()
    const takenCells: GridPosition[] = []
    const connectors = boxes.flatMap(placed => placeConnectors(placed, tools, takenCells, world))
    const connectorWave = allAgents.length * AGENT_STEP + CONNECTOR_GAP
    let connectorIndex = 0

    for (const { box, anchor, agents } of boxes) {
        containers.push(containerFromSpace(space(box.id, box.name, anchor)))

        for (const agent of agents) {
            tiles.push({
                id: agent.id,
                position: agent.cell,
                span: AGENT_SPAN,
                containerId: box.id,
                style: agentTileStyle('idle', agent.name),
                ariaLabel: agent.name,
                // Un décor n'est pas cliquable : sans ça la tuile serait un bouton, et la
                // tabulation depuis le formulaire irait se promener sur vingt losanges.
                selectable: false,
            })
            const drop = agentIds.length * AGENT_STEP
            agentIds.push(agent.id)
            dropDelays.set(agent.id, drop)
        }
    }

    const placedTools = new Set<string>()
    let boardReady = 0

    for (const connector of connectors) {
        const service = CONNECTORS[connector.slug]

        tiles.push({
            id: connector.id,
            position: connector.cell,
            span: 1,
            style: connectorTileStyle(service.icon),
            // Mettre `highlight: true` sur une entrée du catalogue suffit à allumer son halo partout
            // où l'outil apparaît sur la scène.
            highlighted: 'highlight' in service && service.highlight === true,
            ariaLabel: service.name,
            selectable: false,
        })

        const drop = Math.round(connectorWave + connectorIndex * CONNECTOR_STEP + (hashUnit(connector.id, 7) - 0.5) * CONNECTOR_JITTER)
        dropDelays.set(connector.id, drop)

        const appear = drop + CABLE_LAG
        links.push({ source: connector.agentId, target: connector.id, variant: 'cable' })
        appearDelays.set(stageLinkId(connector.agentId, connector.id), appear)
        placedTools.add(connector.id)
        boardReady = Math.max(boardReady, appear + CABLE_DRAW_MS)
        connectorIndex++
    }

    // Chaque câble porte aussi son beam : la plomberie reste branchée, et l'appel s'allume par-dessus
    // le temps que l'agent tient son outil. Les deux liens partagent la paire, TileLinks les
    // distingue par leur variante.
    for (const connector of connectors) links.push({ source: connector.agentId, target: connector.id, variant: 'beam' })
    for (const beam of agentBeams) links.push({ source: beam.source, target: beam.target, variant: 'beam' })

    // Un outil que le glouton n'a pas su poser ne doit pas rester cité par le script : le pas
    // travaillerait dans le vide plutôt que d'allumer un câble.
    const cableOf = (agent: string, tool: ConnectorSlug) => {
        const id = connectorId(agent, tool)
        return placedTools.has(id) ? stageLinkId(agent, id) : null
    }

    const compiled = THREADS.map(thread => compileThread(thread, cableOf))
    assertNoOverlap(compiled.flatMap(thread => thread.spans))

    const linkChanges = compiled.flatMap(thread => thread.changes).map(({ at, agent, links }) => ({ at, agent, links }))
    const frames: StageFrame[] = []
    for (const change of [...linkChanges, ...STATUS_CHANGES].sort((a, b) => a.at - b.at)) {
        const last = frames[frames.length - 1]
        if (last && last.at === change.at) last.changes.push(change)
        else frames.push({ at: change.at, changes: [change] })
    }

    if (process.env.NODE_ENV !== 'production') warnOnCrossings(tiles, links)

    return { tiles, links, containers, agentIds, dropDelays, appearDelays, script: { frames, period: CYCLE_PERIOD, startAt: boardReady + STAGE_SETTLE_MS } }
}

// L'invariant du décor, revérifié sur le board fini et sur les tracés tels que TileLinks les
// dessine au repos (les câbles seuls) : aucun câble n'en croise un autre, aucun ne disparaît sous une
// tuile. Le glouton l'obtient sur le cast actuel, mais il dégrade au lieu d'échouer — c'est ce qui
// préviendra le jour où quelqu'un ajoutera un outil de trop.
export function cableConflicts(tiles: RoutedTile[], links: RoutedLink[]) {
    const cables = links.filter(link => link.variant === 'cable')
    const routes = routeBoard(tiles, cables)
    const drawn = cables.map(link => ({ id: stageLinkId(link.source, link.target), sourceId: link.source, targetId: link.target, points: routes.get(`${link.source}->${link.target}`) ?? [] }))
    const problems: string[] = []

    for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
            if (routesCross(drawn[i], drawn[j])) problems.push(`${drawn[i].id} x ${drawn[j].id}`)
        }
        for (const tile of tiles) {
            if (tile.id === drawn[i].sourceId || tile.id === drawn[i].targetId) continue
            if (routeHitsBox(drawn[i].points, tileAxisBox(tile))) problems.push(`${drawn[i].id} sous ${tile.id}`)
        }
    }
    return problems
}

function warnOnCrossings(tiles: Tile[], links: TileLink[]) {
    const problems = cableConflicts(tiles, links)

    if (problems.length > 0) console.warn(`[auth-stage-board] ${problems.length} conflits de tracé:`, problems)
}
