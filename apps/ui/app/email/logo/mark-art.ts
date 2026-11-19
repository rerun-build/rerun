import { R_PATH } from '@moldwright/ui/logo'

export const MARK_SIZE = 128
export const MARK_DISPLAY = 32

const SCALE = MARK_SIZE / MARK_DISPLAY

const PAGE = '#0a0a0a'
const FOREGROUND = '#fafafa'
const PRIMARY = '#e5e5e5'

const RADIUS = 8 * SCALE
const GRID_CELL = MARK_SIZE / 4
const GRID_OFFSET = GRID_CELL / 2
const GRID_STROKE = 0.5 * SCALE
const GRID_OPACITY = 0.35
const RING_STROKE = 1 * SCALE

const R_SIZE = MARK_SIZE / 2
const R_VIEWBOX = 512

const CORNER = 0.707

const RING_STOPS = [
    [0, 0.65],
    [0.2, 0.12],
    [0.8, 0.12],
    [1, 0.65],
] as const

export function buildMarkSvg(): string {
    const rOffset = (MARK_SIZE - R_SIZE) / 2

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${MARK_SIZE}" height="${MARK_SIZE}" viewBox="0 0 ${MARK_SIZE} ${MARK_SIZE}">
  <defs>
    <pattern id="grid" x="${GRID_OFFSET}" y="${GRID_OFFSET}" width="${GRID_CELL}" height="${GRID_CELL}" patternUnits="userSpaceOnUse">
      <path d="M ${GRID_CELL} 0 L 0 0 L 0 ${GRID_CELL}" fill="none" stroke="${FOREGROUND}" stroke-width="${GRID_STROKE}"/>
    </pattern>
    <radialGradient id="gridFade" r="${CORNER}">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="90%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <mask id="gridMask">
      <rect width="${MARK_SIZE}" height="${MARK_SIZE}" fill="url(#gridFade)"/>
    </mask>
    <radialGradient id="glint" r="${CORNER}">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="70%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      ${RING_STOPS.map(([at, alpha]) => `<stop offset="${at * 100}%" stop-color="#ffffff" stop-opacity="${alpha}"/>`).join('\n      ')}
    </linearGradient>
    <clipPath id="tile">
      <rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${RADIUS}"/>
    </clipPath>
  </defs>
  <rect width="${MARK_SIZE}" height="${MARK_SIZE}" fill="${PAGE}"/>
  <rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${RADIUS}" fill="${PRIMARY}" fill-opacity="0.05"/>
  <g clip-path="url(#tile)">
    <rect width="${MARK_SIZE}" height="${MARK_SIZE}" fill="url(#grid)" mask="url(#gridMask)" opacity="${GRID_OPACITY}"/>
    <rect width="${MARK_SIZE}" height="${MARK_SIZE}" fill="url(#glint)"/>
  </g>
  <rect x="${RING_STROKE / 2}" y="${RING_STROKE / 2}" width="${MARK_SIZE - RING_STROKE}" height="${MARK_SIZE - RING_STROKE}" rx="${RADIUS - RING_STROKE / 2}" fill="none" stroke="url(#ring)" stroke-width="${RING_STROKE}"/>
  <g transform="translate(${rOffset} ${rOffset}) scale(${R_SIZE / R_VIEWBOX})">
    <path fill-rule="evenodd" fill="${FOREGROUND}" d="${R_PATH}"/>
  </g>
</svg>`
}
