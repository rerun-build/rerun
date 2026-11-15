export const ART_WIDTH = 1040
export const ART_HEIGHT = 176

const BASE = '#171717'
const RULE = '#262626'

const TILE_SIZE = 88
const TILE_RADIUS = 20
const ICON_SIZE = 44
const ICON_VIEWBOX = 18

const TILE = {
    x: (ART_WIDTH - TILE_SIZE) / 2,
    y: (ART_HEIGHT - TILE_SIZE) / 2,
    size: TILE_SIZE,
    radius: TILE_RADIUS,
}

const STRIPE_ANGLE = -25
const STRIPE_PERIOD = 42
const STRIPE_WIDTH = 20

const STRIPE_WHITE_OPACITY = 0.025

function stripeOpacity(ink: string): number {
    const channel = (offset: number) => parseInt(ink.slice(offset, offset + 2), 16)
    const mean = (channel(1) + channel(3) + channel(5)) / 3
    const base = parseInt(BASE.slice(1, 3), 16)
    return Number(((STRIPE_WHITE_OPACITY * (255 - base)) / (mean - base)).toFixed(3))
}

const ICONS = {
    check: '<polyline points="2.75 9.5 6.5 13.25 15.25 4.5" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    bell:
        '<path d="M15.75 12.75C14.645 12.75 13.75 11.855 13.75 10.75V6.5C13.75 3.877 11.623 1.75 9 1.75C6.377 1.75 4.25 3.877 4.25 6.5V10.75C4.25 11.855 3.355 12.75 2.25 12.75H15.75Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M10.5 15.3843C10.2005 15.9018 9.6409 16.25 9 16.25C8.3591 16.25 7.7995 15.9018 7.5 15.3843" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    question:
        '<circle cx="9" cy="9" r="7.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M6.925,6.619c.388-1.057,1.294-1.492,2.18-1.492,.895,0,1.818,.638,1.818,1.808,0,1.784-1.816,1.468-2.096,3.065" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M8.791,13.567c-.552,0-1-.449-1-1s.448-1,1-1,1,.449,1,1-.448,1-1,1Z" fill="COLOR"/>',
    thumbsUp:
        '<path d="M5.25,7.494c0-.48,.173-.944,.486-1.307L10,1.25h0c.854,.427,1.25,1.428,.92,2.324l-1.17,3.176h4.402c1.313,0,2.269,1.243,1.933,2.512l-1.191,4.5c-.232,.877-1.026,1.488-1.933,1.488H7.25c-1.105,0-2-.895-2-2" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<rect x="1.75" y="6.75" width="3.5" height="8.5" rx="1" ry="1" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    plug:
        '<line x1="6.25" y1="4.75" x2="6.25" y2="1.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="11.75" y1="4.75" x2="11.75" y2="1.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M3.75,4.75H14.25c.552,0,1,.448,1,1v1.75c0,3.449-2.801,6.25-6.25,6.25h0c-3.449,0-6.25-2.801-6.25-6.25v-1.75c0-.552,.448-1,1-1Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="9" y1="16.25" x2="9" y2="13.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    warning:
        '<path d="M7.63796 3.48996L2.21295 12.89C1.60795 13.9399 2.36395 15.25 3.57495 15.25H14.425C15.636 15.25 16.392 13.9399 15.787 12.89L10.362 3.48996C9.75696 2.44996 8.24296 2.44996 7.63796 3.48996Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M9 6.75V9.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M9 13.5C8.448 13.5 8 13.05 8 12.5C8 11.95 8.448 11.5 9 11.5C9.552 11.5 10 11.9501 10 12.5C10 13.0499 9.552 13.5 9 13.5Z" fill="COLOR"/>',
    inbox:
        '<line x1="3.75" y1="5.75" x2="14.25" y2="5.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="5.75" y1="2.75" x2="12.25" y2="2.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M11.75,8.75v1c0,.552-.448,1-1,1h-3.5c-.552,0-1-.448-1-1v-1H1.787c-.024,.125-.037,.251-.037,.379v3.121c0,1.104,.895,2,2,2H14.25c1.105,0,2-.896,2-2v-3.121c0-.127-.013-.254-.037-.379h-4.463Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    gauge:
        '<path d="M4.009 15.25H13.991C15.38 13.929 16.25 12.068 16.25 10C16.25 5.996 13.004 2.75 9 2.75C4.996 2.75 1.75 5.996 1.75 10C1.75 12.068 2.62 13.929 4.009 15.25Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M9.00005 10L5.89404 6.89401" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M4.75 10C4.75 10.81 4.97499 11.581 5.39799 12.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M12.603 12.25C13.025 11.581 13.25 10.81 13.25 10C13.25 7.657 11.343 5.75 9 5.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    userPlus:
        '<path d="M9 7.2505C10.5188 7.2505 11.75 6.0195 11.75 4.5005C11.75 2.9815 10.5188 1.7505 9 1.7505C7.4812 1.7505 6.25 2.9815 6.25 4.5005C6.25 6.0195 7.4812 7.2505 9 7.2505Z" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M17.25 14.7505H12.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M14.75 12.2505V17.2505" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="M12.2164 10.677C11.2752 10.102 10.1839 9.7505 8.99999 9.7505C6.44899 9.7505 4.26099 11.2805 3.29099 13.4705C2.92599 14.2955 3.37799 15.2444 4.23799 15.5154C5.46299 15.9014 7.08389 16.2495 8.99999 16.2495C9.22329 16.2495 9.43029 16.2319 9.64399 16.2214" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    grid:
        '<rect x="2.75" y="2.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<rect x="10.75" y="2.75" width="4.5" height="4.5" rx="1" ry="1" transform="translate(7.343 -7.728) rotate(45)" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<rect x="2.75" y="10.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<rect x="10.75" y="10.75" width="4.5" height="4.5" rx="1" ry="1" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>',
    calendar:
        '<line x1="5.75" y1="3.25" x2="5.75" y2="1.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="12.25" y1="3.25" x2="12.25" y2="1.25" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<rect x="2.25" y="3.25" width="13.5" height="12.5" rx="2" ry="2" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<line x1="2.25" y1="6.75" x2="15.75" y2="6.75" fill="none" stroke="COLOR" stroke-linecap="round" stroke-linejoin="round" stroke-width="SW"/>' +
        '<path d="m9,8.75c-.551,0-1,.449-1,1s.449,1,1,1,1-.449,1-1-.449-1-1-1Z" fill="COLOR"/>' +
        '<path d="m12.5,10.75c.551,0,1-.449,1-1s-.449-1-1-1-1,.449-1,1,.449,1,1,1Z" fill="COLOR"/>' +
        '<path d="m5.5,11.75c-.551,0-1,.449-1,1s.449,1,1,1,1-.449,1-1-.449-1-1-1Z" fill="COLOR"/>' +
        '<path d="m9,11.75c-.551,0-1,.449-1,1s.449,1,1,1,1-.449,1-1-.449-1-1-1Z" fill="COLOR"/>' +
        '<path d="m12.5,11.75c-.551,0-1,.449-1,1s.449,1,1,1,1-.449,1-1-.449-1-1-1Z" fill="COLOR"/>',
} as const

const VARIANTS = {
    done: { icon: 'check', solid: '#34d399', ink: '#34d399' },
    info: { icon: 'bell', solid: '#a1a1a1', ink: '#d4d4d4' },
    question: { icon: 'question', solid: '#22d3ee', ink: '#22d3ee' },
    approval: { icon: 'thumbsUp', solid: '#f59e0b', ink: '#f59e0b' },
    connector: { icon: 'plug', solid: '#06b6d4', ink: '#06b6d4' },
    failed: { icon: 'warning', solid: '#f87171', ink: '#f87171' },
    digest: { icon: 'inbox', solid: '#4d34f7', ink: '#b7a8ff' },
    budget: { icon: 'gauge', solid: '#4d34f7', ink: '#b7a8ff' },
    invite: { icon: 'userPlus', solid: '#4d34f7', ink: '#b7a8ff' },
    library: { icon: 'grid', solid: '#4d34f7', ink: '#b7a8ff' },
    schedule: { icon: 'calendar', solid: '#4d34f7', ink: '#b7a8ff' },
} as const satisfies Record<string, { icon: keyof typeof ICONS; solid: string; ink: string }>

export const ART_VARIANTS = Object.keys(VARIANTS) as ArtVariant[]
export type ArtVariant = keyof typeof VARIANTS

function icon(name: keyof typeof ICONS, color: string): string {
    const scale = ICON_SIZE / ICON_VIEWBOX
    const x = TILE.x + (TILE.size - ICON_SIZE) / 2
    const y = TILE.y + (TILE.size - ICON_SIZE) / 2
    const markup = ICONS[name].replaceAll('COLOR', color).replaceAll('SW', '1.35')
    return `<g transform="translate(${x} ${y}) scale(${scale})">${markup}</g>`
}

export function buildArtSvg(variant: ArtVariant): string {
    const { solid, ink } = VARIANTS[variant]
    const cx = TILE.x + TILE.size / 2
    const cy = TILE.y + TILE.size / 2

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_WIDTH}" height="${ART_HEIGHT}" viewBox="0 0 ${ART_WIDTH} ${ART_HEIGHT}">
  <defs>
    <pattern id="stripes" width="${STRIPE_PERIOD}" height="${STRIPE_PERIOD}" patternUnits="userSpaceOnUse" patternTransform="rotate(${STRIPE_ANGLE})">
      <rect width="${STRIPE_WIDTH}" height="${STRIPE_PERIOD}" fill="${ink}" fill-opacity="${stripeOpacity(ink)}"/>
    </pattern>
    <linearGradient id="stripeFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <mask id="stripeMask">
      <rect width="${ART_WIDTH}" height="${ART_HEIGHT}" fill="url(#stripeFade)"/>
    </mask>
    <radialGradient id="glow">
      <stop offset="0%" stop-color="${solid}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${solid}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="tileFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${solid}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${solid}" stop-opacity="0.09"/>
    </linearGradient>
  </defs>
  <rect width="${ART_WIDTH}" height="${ART_HEIGHT}" fill="${BASE}"/>
  <rect width="${ART_WIDTH}" height="${ART_HEIGHT}" fill="url(#stripes)" mask="url(#stripeMask)"/>
  <ellipse cx="${cx}" cy="${cy}" rx="104" ry="66" fill="url(#glow)"/>
  <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}" fill="url(#tileFace)"/>
  <rect x="${TILE.x + 0.75}" y="${TILE.y + 0.75}" width="${TILE.size - 1.5}" height="${TILE.size - 1.5}" rx="${TILE.radius - 0.75}" fill="none" stroke="${solid}" stroke-opacity="0.4" stroke-width="1.5"/>
  ${icon(VARIANTS[variant].icon, ink)}
  <rect y="${ART_HEIGHT - 1}" width="${ART_WIDTH}" height="1" fill="${RULE}"/>
</svg>`
}
