import { COWORKER_EYES, COWORKER_MATERIALS, COWORKER_MOUTHS, FOREMAN_AGENT_ID, type CoworkerLook } from '@rerun/contracts'
import { hashedBuddyLook } from '@rerun/ui/iso-grid/buddy-look'

import { APP_URL } from '@/lib/app-url'

// Bump on any change to the drawing: phones and proxies keep a portrait for good.
export const PORTRAIT_VERSION = '1'

// Captured at 2x. A phone crops it to a circle of 64 points at most.
export const PORTRAIT_SIZE = 128

export type CoworkerPortrait = { kind: 'foreman' } | { kind: 'buddy'; look: Required<CoworkerLook> }

// The address names a look and nothing else: a phone downloads it signed out, so it can carry neither
// the coworker's id nor its name, and every word of it comes from a closed list.
function portraitSlug(agentId: string, look: CoworkerLook | null): string {
    if (agentId === FOREMAN_AGENT_ID) return FOREMAN_AGENT_ID
    const { eyes, mouth, color, material = 'classic' } = look ?? hashedBuddyLook(agentId)
    return [eyes, mouth, color.slice(1).toLowerCase(), material].join('-')
}

// `origin` is the app of the brand the picture is shown under: an email of an organization loads it
// from the organization's address.
export function coworkerPortraitUrl(agentId: string, look: CoworkerLook | null, origin: string = APP_URL): string {
    return `${origin}/og/coworker/${portraitSlug(agentId, look)}?v=${PORTRAIT_VERSION}`
}

// The same buddy alone, turned towards the words it says: beside its message in an email, on a dark card.
export const BARE_PARAM = 'bare'

const BARE_SIDES = ['left', 'right'] as const
export type BareSide = (typeof BARE_SIDES)[number]

export const bareSideOf = (value: string | null | undefined): BareSide | null => BARE_SIDES.find(side => side === value) ?? null

export function bareCoworkerPortraitUrl(agentId: string, look: CoworkerLook | null, facing: BareSide, origin?: string): string {
    return `${coworkerPortraitUrl(agentId, look, origin)}&${BARE_PARAM}=${facing}`
}

export function portraitOfSlug(slug: string): CoworkerPortrait | null {
    if (slug === FOREMAN_AGENT_ID) return { kind: 'foreman' }
    const [eyesPart, mouthPart, colorPart, materialPart, ...rest] = slug.split('-')
    const eyes = COWORKER_EYES.find(value => value === eyesPart)
    const mouth = COWORKER_MOUTHS.find(value => value === mouthPart)
    const color = /^[0-9a-f]{6}$/.test(colorPart ?? '') ? `#${colorPart}` : undefined
    const material = COWORKER_MATERIALS.find(value => value === materialPart)
    if (!eyes || !mouth || !color || !material || rest.length) return null
    return { kind: 'buddy', look: { eyes, mouth, color, material } }
}
