import { SPACE_COLOR, agentTileStyle, connectorTileStyle } from '../iso-grid/presets'
import type { Container, Tile, TileLink } from '../iso-grid/types'
import { GRID_SIZE, TILE_H, TILE_W, hashUnit, isoPosition } from '../iso-grid/iso'

// The board the onboarding tour builds, one slide at a time. Five phases, and the board is a **pure
// function of the phase index**: the lab can jump straight to the last one, reduced motion renders
// it frozen, and walking the tour cannot drift out of sync with itself. The landing plays the same
// board from the same function, its phase coming from the scroll instead of a Continue button, which
// is why the module lives in the package rather than in either app.
//
// Everything here is a constant. The module runs during server rendering, so a position or a delay
// drawn at random would move between the server HTML and the first client paint: the only jitter
// allowed is hashUnit(id, salt).
//
// **The board is built on the way out and comes apart on the way back.** The retreat is what makes
// the second half possible: a tile removed from the array vanishes on the spot, the package having
// no exit animation for one, so a piece leaving is put in retreat first and dropped from the array
// only once it has faded, the two beats being held by useTourStage. `livePhase` is what says which
// pieces are on their way out; everything else here reads the phase the board is rendered at, which
// is still holding them.

export const TOUR_PHASE_KEYS = ['private-server', 'agents', 'bring-your-own-model', 'connectors', 'team'] as const
export type TourPhaseKey = (typeof TOUR_PHASE_KEYS)[number]

export const LAST_TOUR_PHASE = TOUR_PHASE_KEYS.length - 1

// Written once by apps/ui/scripts/seed-onboarding-tour-board.ts, which lays them under the public
// directory of **both** apps, and committed, never resolved against the services catalogue: the
// scene draws itself over five slides and a logo that lands two seconds after its tile reads as a
// bug. `?tone=dark` marks the brands drawn in black, which is what connectorTileStyle reads to flip
// them to a white silhouette on the near-black connector tile.
const mark = (file: string) => `/onboarding/tour/board/${file}`

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

// The three Boxes almost every company recognises. They carry SPACE_COLOR, the same neutral every
// Box on the real board carries, and not three tints: a tinted Box paints its standing label in its
// own colour, and a violet or a green word on a near-black floor is unreadable at the zoom a dialog
// affords. The names are the whole argument of the first slide, so they win. Neutral is also the
// truth — this is what the board the user is about to get looks like.
//
// `col_end` / `row_end` are **inclusive** (containerDiamond draws up to col_end + 1), so the two arms
// are five cells on a side and Marketing is six. Marketing is wider because it holds three agents and
// a span-2 agent takes two cells: at five, the three of them touch edge to edge and read as one slab
// cut into pieces rather than as three machines. Six and not seven, which is what the two southern
// faces buy: the writer and the manager end up **flush** against them, so the floor reads as a
// footprint the machines fill rather than as a slab with a margin running around it, and every tool
// hanging off Marketing ends up exactly one free cell off the face it plugs into. The extra cell over
// the arms is taken on the **north-west**, the one side that costs nothing: the arms hang off the
// south and east, and the west corner the wide shot is fitted on belongs to Sales.
type TourBox = { id: string; name: string; col_start: number; row_start: number; col_end: number; row_end: number }

// A triangle: Marketing at the apex, Sales and Ops side by side underneath it. Equal col + row is
// equal screen height, so the two lower Boxes land on exactly the same line, and col minus row being
// opposite puts them at mirrored distances from the middle. Three Boxes on one iso axis would read
// as a table instead of a workspace, and a zigzag as an accident.
//
// Five free cells separate the apex from each arm, which is what makes the three Boxes read as three
// machines standing apart rather than one block cut into pieces, and what gives Calendly and Notion,
// which live in that corridor, air on either side instead of being welded to a Box.
//
// The corridor is paid for out of the width, and the width is what the wide shot is fitted on, so
// the arms are pulled **two cells back towards the axis** to pay for it: Sales is offset on col and
// Ops on row, which on screen is one step inwards and half a step down for each of them. That keeps
// the corridor wide while the scene stays 672 units wide, which is the zoom the shot had when the
// corridor was two (0.97 in the dialog; the same scene with the arms left out where they were fits
// at 0.83). What it costs instead is the ratio: the plateau is no longer twice as wide as it is
// tall, so a dialog shorter than about 460 free units starts binding the fit on the height.
//
// The whole scene is built to be **invariant under swapping col and row**, which is the mirror of
// the screen's vertical axis: Marketing folds onto itself, Sales becomes Ops. Every tile below has a
// twin one line away, and moving one without its twin is what breaks the composition.
export const TOUR_BOXES: readonly TourBox[] = [
    { id: 'tour-marketing', name: 'Marketing', col_start: 0, row_start: 0, col_end: 4, row_end: 4 },
    { id: 'tour-sales', name: 'Sales', col_start: 4, row_start: 11, col_end: 8, row_end: 15 },
    { id: 'tour-ops', name: 'Ops', col_start: 11, row_start: 4, col_end: 15, row_end: 8 },
]

// Two agents per Box, always on the **anti-diagonal** of its rectangle (equal col + row), never on
// the diagonal: two tiles on the diagonal share a screen column and stack on top of each other. The
// anti-diagonal puts them on the west and east corners of the Box, which is also what gives each of
// them a face of the Box pointing away from the middle of the scene to hang its connectors on.
//
// Marketing is the exception and carries three, because it is the Box the connectors slide closes in
// on and two names is a pair rather than a team. Its three cells are **all but forced**, which is
// worth writing down because they look like a free choice and are not.
//
// The writer's row and the manager's column are pinned by the hand-offs of the last slide: the
// router only comes out in a single straight run when the source sits exactly one cell off the
// target's face, which for the two arms where they stand means row 4 and column 4. The watcher has
// to be its own mirror image, so its col must equal its row; it has to keep a free cell from both
// neighbours; and it cannot stand on either of the two lines the hand-off beams leave along, u = 6
// and v = 6, or a beam runs underneath it and disappears. That leaves the middle of the diagonal,
// two screen rows below the other two, which is also where the eye has room: with all three agents
// up top the marks pile into the upper third and the bottom half of the close shot is bare grid.
type TourAgent = { id: string; name: string; boxId: string; col: number; row: number }

export const TOUR_AGENTS: readonly TourAgent[] = [
    { id: 'tour-watch', name: 'Competitor watch', boxId: 'tour-marketing', col: 0, row: 0 },
    { id: 'tour-writer', name: 'SEO writer', boxId: 'tour-marketing', col: 0, row: 3 },
    { id: 'tour-social', name: 'Social manager', boxId: 'tour-marketing', col: 3, row: 0 },
    { id: 'tour-research', name: 'Lead researcher', boxId: 'tour-sales', col: 7, row: 12 },
    { id: 'tour-desk', name: 'Deal desk', boxId: 'tour-sales', col: 5, row: 14 },
    { id: 'tour-docs', name: 'Doc keeper', boxId: 'tour-ops', col: 12, row: 7 },
    { id: 'tour-invoices', name: 'Invoice chaser', boxId: 'tour-ops', col: 14, row: 5 },
]

// A connector sits **outside** its Box, two cells off its agent's footprint: the Box holds the
// machine, the tools plug into it from the outside, and the free cell in between is what keeps the
// cable visible instead of swallowed by the block. Marketing is cut to its agents (cf. TOUR_BOXES),
// so around the Box the close shot frames, that free cell is also the one between the tool and the
// floor: all six of its marks stand one cell off the face they plug into, on all four sides.
//
// The two connectors of one agent **straddle** its footprint along the face they hang off, one on
// either side, never both past the same end. Stacked on the same side, the cable to the far one
// leaves through the same face centre as the near one and runs straight under it: the router does no
// avoidance at all, so the clearance is won at placement. tour-board.test.ts is what holds this.
//
// `phase` is when it lands, and it also decides what the link to it is made of. The model marks come
// in on the subscription slide and keep a **beam** for the rest of the scene: the slide's argument
// is the subscription the user already pays for, and a lit line running from the agent to the mark
// is what says the plan is in use rather than merely wired. The tools landing after it get the plain
// cable, or the emphasis would stop meaning anything.
//
// Not every agent wears a mark, here or on the arms: four of the seven do. The board says which
// plans are in use, not that each machine needs its own.
type TourConnector = { id: string; name: string; icon: string; agentId: string; additionalAgentIds?: readonly string[]; col: number; row: number; phase: 2 | 3 }

// The phase the model marks land on. They are the only connectors the board ever lights up, and they
// land already lit and stay lit for the rest of the tour: the halo says which tiles are the plan the
// user already pays for, which is as true on the last slide as on the one that argues it. Switching
// it per slide is what reads as a bug, the same four tiles going out and coming back as the words
// change.
export const TOUR_MODEL_PHASE = 2

// The four model marks land on the four points of the scene — two on Marketing's flanks, two at the
// outer bottom corners — so the slide they belong to reads as a diamond over the whole board rather
// than as four tiles lost among the tools. Four and not five, even now that Marketing has a third
// agent: a fifth mark would put a lit tile inside the diamond and the figure would stop reading.
export const TOUR_CONNECTORS: readonly TourConnector[] = [
    // Marketing spreads its marks over the whole height of the close shot rather than crowding the
    // apex: the two model marks alone crown the Box, the tools of the two upper agents hang off the
    // outer flanks below it, and the watcher, which stands lower than its two neighbours, hangs its
    // own two underneath, a step further in towards the axis than the flank pair so the two do not
    // read as one four-tile bar. Piled above the Box they filled the upper third and left the bottom
    // half of the shot as bare grid.
    { id: 'tour-anthropic', name: 'Claude', icon: mark('anthropic.svg'), agentId: 'tour-writer', additionalAgentIds: ['tour-watch'], col: -2, row: 3, phase: 2 },
    { id: 'tour-openai', name: 'ChatGPT', icon: mark('openai.svg?tone=dark'), agentId: 'tour-social', col: 3, row: -2, phase: 2 },
    { id: 'tour-semrush', name: 'Semrush', icon: mark('semrush.svg'), agentId: 'tour-writer', col: 0, row: 6, phase: 3 },
    { id: 'tour-webflow', name: 'Webflow', icon: mark('webflow.svg'), agentId: 'tour-writer', col: 2, row: 6, phase: 3 },
    { id: 'tour-instagram', name: 'Instagram', icon: mark('instagram.svg'), agentId: 'tour-social', col: 6, row: -1, phase: 3 },
    { id: 'tour-tiktok', name: 'TikTok', icon: mark('tiktok.svg?tone=dark'), agentId: 'tour-social', col: 6, row: 1, phase: 3 },
    { id: 'tour-linkedin', name: 'LinkedIn', icon: mark('linkedin.svg'), agentId: 'tour-social', col: 6, row: 3, phase: 3 },
    { id: 'tour-reddit', name: 'Reddit', icon: mark('reddit.svg'), agentId: 'tour-watch', col: 0, row: -2, phase: 3 },
    { id: 'tour-slack', name: 'Slack', icon: mark('slack.svg?v=multicolour'), agentId: 'tour-watch', col: 1, row: -2, phase: 3 },

    // Sales and Ops hang theirs outward and below, away from the middle the two Boxes share.
    { id: 'tour-openrouter', name: 'OpenRouter', icon: mark('openrouter.svg?tone=dark'), agentId: 'tour-desk', col: 10, row: 17, phase: 2 },
    { id: 'tour-grok', name: 'Grok', icon: mark('grok.svg?tone=dark'), agentId: 'tour-invoices', col: 17, row: 8, phase: 2 },
    { id: 'tour-hubspot', name: 'HubSpot', icon: mark('hubspot.svg'), agentId: 'tour-desk', col: 7, row: 17, phase: 3 },
    { id: 'tour-stripe', name: 'Stripe', icon: mark('stripe.svg'), agentId: 'tour-invoices', col: 12, row: 2, phase: 3 },
    { id: 'tour-gmail', name: 'Gmail', icon: mark('gmail.svg'), agentId: 'tour-research', col: 10, row: 11, phase: 3 },
    { id: 'tour-sheets', name: 'Google Sheets', icon: mark('google-sheets.svg'), agentId: 'tour-docs', col: 14, row: 10, phase: 3 },
    // These two sit inside the triangle rather than outside it: the standing label of a Box runs up
    // its top-left edge, and the outer cell each of them would otherwise take is exactly where the
    // word Sales is written.
    { id: 'tour-calendly', name: 'Calendly', icon: mark('calendly.svg'), agentId: 'tour-research', col: 5, row: 9, phase: 3 },
    { id: 'tour-notion', name: 'Notion', icon: mark('notion.svg?tone=dark'), agentId: 'tour-docs', col: 9, row: 7, phase: 3 },
]

// The hand-offs the team slide plays out. Both routes come out a **single straight run**, and that is
// what picks the target: the router leaves through a face centre, so it only comes out straight when
// the two tiles are exactly one cell apart on one of the iso axes, which of the two agents of an arm
// satisfies that depends on where the arm sits. Pulling the arms in moved it from the near agent to
// the far one. The pair two Boxes at the same screen height would make is the opposite case, and
// draws the huge elbow around the bottom of the scene.
//
// They radiate from the apex rather than chaining Marketing to Sales to Ops: the two lower Boxes
// share a screen line, so the last leg of a chain would be exactly that elbow.
export const TOUR_HANDOFFS: readonly { id: string; source: string; target: string }[] = [
    { id: 'handoff-marketing-sales', source: 'tour-social', target: 'tour-desk' },
    { id: 'handoff-marketing-ops', source: 'tour-writer', target: 'tour-invoices' },
]

export const TOUR_AGENT_IDS = TOUR_AGENTS.map(agent => agent.id)

// The phase the seven agents land on, and the one they leave again on the way back.
export const TOUR_AGENTS_PHASE = 1

// The Box the connectors slide closes in on, and everything that belongs to it: its two agents and
// the four tools they plug in. One set, read both by the shot that frames it and by the retreat that
// empties the rest of the plateau, so the camera and the fade cannot end up disagreeing on what
// Marketing is.
export const FOCUS_BOX_ID = 'tour-marketing'
const FOCUS_AGENTS = TOUR_AGENTS.filter(agent => agent.boxId === FOCUS_BOX_ID)
export const FOCUS_TILE_IDS: ReadonlySet<string> = new Set([...FOCUS_AGENTS.map(agent => agent.id), ...TOUR_CONNECTORS.filter(connector => FOCUS_AGENTS.some(agent => agent.id === connector.agentId)).map(connector => connector.id)])

export function linkId(source: string, target: string) {
    return `${source}->${target}`
}

// ---------------------------------------------------------------------------
// Cascade
// ---------------------------------------------------------------------------
// The values the template preview boards are already calibrated on: a fixed step on its own sounds
// like a metronome, hence the jitter, and a cable plugs itself in once its tile is two thirds of the
// way down rather than while it is still falling.
// A Box takes far longer than a tile, and the three are spaced so that one is nearly finished before
// the next starts: the first slide has nothing else to show, and three footprints drawing at once
// read as one event rather than as three machines being provisioned.
const BOX_STEP = 620
const BOX_DRAW_MS = 900
// The agents own a slide of their own, so the cascade is played rather than dispatched: a step that
// reads as a queue being staffed one machine at a time, and a beat of silence first so the words of
// the slide are read before the first tile drops. TOUR_AGENTS is already ordered Marketing, Sales,
// Ops, so the wave fills the three Boxes one after the other without being sorted.
const AGENT_LEAD = 260
const AGENT_STEP = 190
const CONNECTOR_GAP = 220
const CONNECTOR_STEP = 90
const CONNECTOR_JITTER = 70
const CABLE_LAG = 380
// The connectors phase opens on a camera move (cf. Framing below), and a tile landing while the
// scene is still gliding under it reads as a hiccup. Slightly shorter than the move itself: the
// first tool touches down on its tail, which is what keeps the slide from opening on dead air.
export const TOUR_CAMERA_SETTLE = 520

function jitter(id: string) {
    return Math.round((hashUnit(id, 7) - 0.5) * CONNECTOR_JITTER)
}

// ---------------------------------------------------------------------------
// The board at a given phase
// ---------------------------------------------------------------------------

export type TourBoard = {
    containers: Container[]
    tiles: Tile[]
    links: TileLink[]
}

// The phase whose pieces play their landing. Everything below it is already standing, everything
// above it is not on the board yet. Null freezes the board whole (reduced motion, a still capture,
// or a phase reached by walking back into it).
//
// `lit` is the halo of the model marks. It is not a phase of its own: the caller turns it on with the
// phase the marks land on and leaves it on.
//
// `focused` is the close-up: everything that is not the Box the camera is on is put in retreat. Read
// off the **current** phase, exactly like the camera it belongs to (cf. Framing below): the shot
// comes and goes, and walking back onto the connectors slide has to close in again.
//
// `livePhase` is the phase the slide actually tells, which is only ever lower than the phase the
// board is rendered at: everything above it is on its way out, and is drawn in retreat until the
// caller drops it. Left out, it is the rendered phase and nothing is on its way out.
export type TourBoardOptions = { animatedPhase: number | null; lit?: boolean; focused?: boolean; livePhase?: number }

function containerFor(box: TourBox, index: number, animated: boolean, dimmed: boolean): Container {
    return {
        id: box.id,
        dimmed,
        label: box.name,
        color: SPACE_COLOR,
        col_start: box.col_start,
        row_start: box.row_start,
        col_end: box.col_end,
        row_end: box.row_end,
        ariaLabel: `Box: ${box.name}`,
        justPlaced: animated,
        dropDelay: animated ? index * BOX_STEP : undefined,
        // The first slide gives each part of the business its own Box, so the footprint is drawn
        // rather than faded in: an outline running around the diamond before the floor fills is the
        // only thing on that slide that reads as something being built.
        dropStyle: animated ? 'draw' : undefined,
        dropDuration: animated ? BOX_DRAW_MS : undefined,
    }
}

function agentTile(agent: TourAgent, delay: number | null, dimmed: boolean): Tile {
    return {
        id: agent.id,
        dimmed,
        position: { col: agent.col, row: agent.row },
        span: 2,
        containerId: agent.boxId,
        style: agentTileStyle('idle', agent.name),
        // Without this a TileBlock keeps role="button" tabIndex={0} even with no onTileSelect, and
        // tabbing through the dialog walks a dozen diamonds on the way to the footer.
        selectable: false,
        draggable: false,
        justPlaced: delay !== null,
        dropDelay: delay ?? undefined,
        ariaLabel: agent.name,
    }
}

function connectorTile(connector: TourConnector, delay: number | null, lit: boolean, dimmed: boolean): Tile {
    return {
        id: connector.id,
        dimmed,
        position: { col: connector.col, row: connector.row },
        span: 1,
        style: connectorTileStyle(connector.icon),
        highlighted: lit && connector.phase === TOUR_MODEL_PHASE,
        selectable: false,
        draggable: false,
        justPlaced: delay !== null,
        dropDelay: delay ?? undefined,
        ariaLabel: connector.name,
    }
}

export function boardForPhase(phase: number, { animatedPhase, lit = false, focused = false, livePhase }: TourBoardOptions = { animatedPhase: null }): TourBoard {
    const current = Math.min(Math.max(phase, 0), LAST_TOUR_PHASE)
    const live = Math.min(livePhase ?? current, current)
    // The other half of the close-up. Cropping alone does not isolate the Box: the shot hangs high
    // enough that Sales and Ops still show a shoulder underneath it, and Calendly and Notion, which
    // sit inside the triangle rather than outside it, plug themselves in in the middle of the frame.
    //
    // The close-up and the way out are OR'd rather than tested one after the other, which is what
    // walking back off the connectors slide needs: a tool already faded by the close-up is leaving at
    // the very moment the camera pulls back, and reading the shot first would light it up again for
    // the length of the move before it goes.
    const dimmed = (tileId: string, tilePhase: number) => (focused && !FOCUS_TILE_IDS.has(tileId)) || tilePhase > live
    const containers = TOUR_BOXES.map((box, index) => containerFor(box, index, animatedPhase === 0, focused && box.id !== FOCUS_BOX_ID))

    const tiles: Tile[] = []
    const links: TileLink[] = []
    if (current === 0) return { containers, tiles, links }

    const settle = animatedPhase !== null && isTourFocusPhase(animatedPhase) ? TOUR_CAMERA_SETTLE : 0

    // The agents land on their own slide, which is played wide and opens on no camera move, so the
    // wave is counted from the moment the words come in.
    const agentsAnimated = animatedPhase === TOUR_AGENTS_PHASE
    TOUR_AGENTS.forEach((agent, index) => {
        tiles.push(agentTile(agent, agentsAnimated ? AGENT_LEAD + index * AGENT_STEP : null, dimmed(agent.id, TOUR_AGENTS_PHASE)))
    })

    // The connector wave of a phase is counted flat across the whole board rather than per agent: it
    // is one cascade sweeping the scene, not three that each start over from zero. Both waves open
    // the same way, on a board that is already standing: the model marks on their own slide right
    // away, the tools on the tail of the camera move that closes in on Marketing.
    const waveStart = settle + CONNECTOR_GAP
    let landed = 0

    for (const connector of TOUR_CONNECTORS) {
        if (connector.phase > current) continue
        const faded = dimmed(connector.id, connector.phase)
        // A tile that lands in retreat does not land at all: agent-drop-in drives its opacity in
        // keyframes, so it would fall at full strength and snap back to a ghost a second later. The
        // tools wiring themselves off frame are simply standing there when the camera pulls back, and
        // the wave the slide actually plays is the one the shot holds.
        const animated = animatedPhase === connector.phase && !faded
        const delay = animated ? waveStart + landed * CONNECTOR_STEP + jitter(connector.id) : null
        if (animated) landed++

        tiles.push(connectorTile(connector, delay, lit, faded))
        for (const agentId of [connector.agentId, ...(connector.additionalAgentIds ?? [])]) {
            links.push({
                source: agentId,
                target: connector.id,
                variant: connector.phase === TOUR_MODEL_PHASE ? 'beam' : 'cable',
                appearDelay: delay === null ? undefined : delay + CABLE_LAG,
            })
        }
    }

    return { containers, tiles, links }
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------
// The tour is told in two shots, and the camera moves exactly twice. Four slides are played wide on
// the whole scene: the Boxes drawing themselves, the agents landing in them, the marks of the
// subscription they run on lighting up, and the team walking the finished plateau. The **connectors
// slide alone** is played close on Marketing: eight tools plugging themselves into six agents across
// three Boxes at once is a plateau nobody can read, so the camera picks one Box, the rest of the
// board draws back into a ghost (cf. `focused`) and wires itself off frame. Walking on to the team
// slide is what brings it all back, in the same move as the camera pulling out.
//
// One shot for that slide and no other, which is the point: a camera that pulls back a little
// between two slides reads as drift, not as a plan. The grid takes `camera` as a controlled prop and
// only moves when the value changes, so the scene is measured on the frame it actually gets and the
// two slides on either side of the close-up sit on the exact same wide shot.

const CENTER_ISO = isoPosition(GRID_SIZE / 2, GRID_SIZE / 2)

const FOCUS_PHASE = TOUR_PHASE_KEYS.indexOf('connectors')

export function isTourFocusPhase(phase: number) {
    return phase === FOCUS_PHASE
}

// How much of the frame a shot is fitted into, and where the fitted content sits in it.
//
// The wide shot stays just under 1 and is centred, and its zoom is won by drawing the three Boxes
// closer together instead: the leftmost and rightmost points of the whole scene are the west and
// east corners of Sales and Ops, a Box anchors its standing label on its west corner, and any
// overshoot beheads Sales and Ops before it touches a single connector.
//
// The close shot is **centred**, like the wide one, and `sky` is left off. It used to hang from the
// top of the frame, and that was a fix for a shape it no longer has: with every mark piled above
// Marketing the group was twice as wide as it was tall, the fit was won on the width, and the whole
// slack fell on the height. Parked overhead it pushed the marks down to the middle of the dialog
// and left the top half as empty grid, so the shot was hung from the ceiling instead. Marketing now
// spreads its six marks from above the Box down to well below it, which spends that slack on the
// scene rather than on framing: there is little left to park anywhere, and centring is what reads.
//
// `sky` stays in the shot type because it is what a short, top-heavy group needs, and Marketing is
// one edit away from being one again.
//
// The close shot insets on both axes, and the width is the one that matters: it is what the fit
// binds on, so it is the only one that ever spends zoom. It buys the thing the bounds cannot see —
// a lit model mark is drawn as four walls of light standing on its tile, and the tile fitting in
// the frame is not the same as the light fitting in it. Flush to the edge, the outermost mark on
// each flank gets its column shaved off by the dialog.
const WIDE = { insetX: 0.97, insetY: 0.97, maxZoom: 1.6, sky: null }
const FOCUS = { insetX: 0.88, insetY: 0.9, maxZoom: 2.6, sky: null }
const MIN_ZOOM = 0.3

type Bounds = { left: number; right: number; top: number; bottom: number }
type Footprint = { col: number; row: number; span: number }

function boundsOf(boxes: readonly TourBox[], footprints: readonly Footprint[]): Bounds {
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity

    const grow = (x: number, y: number, width: number, height: number) => {
        left = Math.min(left, x)
        right = Math.max(right, x + width)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y + height)
    }

    for (const box of boxes) {
        // A container is drawn as the diamond of its rectangle, whose corners run one cell past
        // col_end / row_end, and whose x is taken at the middle of the cell (cf. containerDiamond).
        for (const [col, row] of [
            [box.col_start, box.row_start],
            [box.col_end + 1, box.row_start],
            [box.col_end + 1, box.row_end + 1],
            [box.col_start, box.row_end + 1],
        ]) {
            const { left: isoLeft, top: isoTop } = isoPosition(col, row)
            grow(isoLeft + TILE_W / 2 - CENTER_ISO.left, isoTop - CENTER_ISO.top, 0, 0)
        }
    }

    for (const { col, row, span } of footprints) {
        const { left: isoLeft, top: isoTop } = isoPosition(col, row)
        // Same horizontal centering as TileBlock: the anchor is the north cell of the footprint.
        grow(isoLeft - ((span - 1) * TILE_W) / 2 - CENTER_ISO.left, isoTop - CENTER_ISO.top, span * TILE_W, span * TILE_H)
    }

    return { left, right, top, bottom }
}

const AGENT_SPAN = 2
const CONNECTOR_SPAN = 1

const AGENT_FOOTPRINTS = TOUR_AGENTS.map(agent => ({ col: agent.col, row: agent.row, span: AGENT_SPAN }))

export const TOUR_STAGE_BOUNDS = boundsOf(TOUR_BOXES, [...AGENT_FOOTPRINTS, ...TOUR_CONNECTORS.map(connector => ({ col: connector.col, row: connector.row, span: CONNECTOR_SPAN }))])

// The same plateau taken before anything is plugged into it. The two are the same width to the
// pixel, the far corners of Sales and Ops being the outermost points of the scene either way, so
// what this buys is the vertical centring: fitted with the tools in, a scene that stops at the
// agents sits a dozen units high, holding room for marks that never land.
const UNWIRED_STAGE_BOUNDS = boundsOf(TOUR_BOXES, AGENT_FOOTPRINTS)

// The Box, its two agents and **all** of its connectors, the ones already standing as much as the
// ones about to land. A connector hangs outside its Box, so a shot fitted to what is on the board
// when the camera arrives would crop the very tools the slide exists to draw.
function focusBounds(): Bounds {
    const box = TOUR_BOXES.find(b => b.id === FOCUS_BOX_ID)
    if (!box) return TOUR_STAGE_BOUNDS
    return boundsOf([box], [...FOCUS_AGENTS.map(agent => ({ col: agent.col, row: agent.row, span: AGENT_SPAN })), ...TOUR_CONNECTORS.filter(connector => FOCUS_TILE_IDS.has(connector.id)).map(connector => ({ col: connector.col, row: connector.row, span: CONNECTOR_SPAN }))])
}

const FOCUS_BOUNDS = focusBounds()

// Same world coordinates as the grid itself: pan is applied inside the scale, so panning by the
// opposite of the content centre puts the shot dead centre.
type Shot = { insetX: number; insetY: number; maxZoom: number; sky: number | null }

function frameBounds(bounds: Bounds, frame: { width: number; height: number }, { insetX, insetY, maxZoom, sky }: Shot) {
    const width = bounds.right - bounds.left
    const height = bounds.bottom - bounds.top
    const fit = Math.min((frame.width * insetX) / width, (frame.height * insetY) / height)
    const zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, fit))
    const half = frame.height / (2 * zoom)
    // Centred, or hung from the top edge by however much of the slack the cap allows overhead.
    const overhead = sky === null ? 0 : Math.min(half * 2 - height, height * sky)
    return {
        zoom,
        pan: {
            x: -(bounds.left + bounds.right) / 2,
            y: sky === null ? -(bounds.top + bounds.bottom) / 2 : overhead - bounds.top - half,
        },
    }
}

// `connectors` is how far the plateau being framed goes: a scene played without the tools (the decor
// of the Box dialogs) is fitted on the bare Boxes instead.
export function frameTourStage(frame: { width: number; height: number }, { connectors = true }: { connectors?: boolean } = {}) {
    return frameBounds(connectors ? TOUR_STAGE_BOUNDS : UNWIRED_STAGE_BOUNDS, frame, WIDE)
}

// The shot a slide is played in. Both are measured on the same frame, or the close one would drift
// vertically against the grid's world anchor.
export function frameTourPhase(phase: number, frame: { width: number; height: number }) {
    return isTourFocusPhase(phase) ? frameBounds(FOCUS_BOUNDS, frame, FOCUS) : frameTourStage(frame)
}

// Where an agent tile stands in world coordinates, for anything laid over the grid's world layer.
// The teammate cursors need it: worldOverlay renders inside the transformed layer, so a cursor is
// positioned in the grid's own coordinates and counter-scaled by the zoom it is handed.
export function tourAgentWorldCenter(agentId: string) {
    const agent = TOUR_AGENTS.find(a => a.id === agentId)
    if (!agent) return { x: 0, y: 0 }
    const { left, top } = isoPosition(agent.col, agent.row)
    return { x: left - CENTER_ISO.left + TILE_W / 2, y: top - CENTER_ISO.top + TILE_H }
}
