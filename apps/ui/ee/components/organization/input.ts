import { MICROS_PER_CREDIT, normalizeHex } from '@rerun/contracts'
import { z } from 'zod'

import { normalizeHostname } from '@/ee/lib/organizations/hostname'
import { LOGO_MAX_BYTES } from '@/lib/workspace/logo-input'

import type { BrandFields } from './types'

const emailSchema = z.email()

export function isEmail(value: string): boolean {
    return emailSchema.safeParse(value).success
}

// As the database holds it: written `https://`, which a parser also reads out of `HTTPS://x` or `https:x`.
export function isHttpsUrl(value: string): boolean {
    return value.startsWith('https://') && URL.canParse(value)
}

// What can be moved out of a balance: whole credits, so a fraction is never promised. A balance of
// 9.6 moves 9, and the console says 9 wherever a move is offered.
export const wholeCredits = (micros: number): number => Math.floor(micros / MICROS_PER_CREDIT)

// Whole credits, whatever a person types between the digits. Null while nothing usable is there.
export function readCredits(value: string): number | null {
    const digits = value.replace(/\D/g, '').slice(0, 9)
    return digits ? Number(digits) : null
}

export type HostnameReading = { hostname: string; problem: 'invalid' | 'apex' | null }

// An address pasted from a browser is read as its domain. A CNAME cannot sit on a bare domain.
export function readHostname(value: string): HostnameReading {
    const hostname = value
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/[/?#:].*$/, '')
        .replace(/\.$/, '')
    const name = normalizeHostname(hostname)
    if (!name) return { hostname, problem: 'invalid' }
    return { hostname: name, problem: name.split('.').length < 3 ? 'apex' : null }
}

export const BRAND_NAME_MAX = 40
export const BRAND_NAME_REFUSED = '{ } < > # |'

export type BrandProblem = 'nameInvalid' | 'colorInvalid' | 'emailInvalid' | 'urlInvalid'

export function brandProblems(fields: BrandFields): Partial<Record<keyof BrandFields, BrandProblem>> {
    const name = fields.name.trim()
    const problems: Partial<Record<keyof BrandFields, BrandProblem>> = {}
    if (!name || name.length > BRAND_NAME_MAX || /[{}<>#|\p{Cc}]/u.test(name)) problems.name = 'nameInvalid'
    if (fields.color && !normalizeHex(fields.color)) problems.color = 'colorInvalid'
    if (fields.supportEmail && !isEmail(fields.supportEmail.trim())) problems.supportEmail = 'emailInvalid'
    for (const key of ['docsUrl', 'termsUrl', 'privacyUrl'] as const) if (fields[key] && !isHttpsUrl(fields[key].trim())) problems[key] = 'urlInvalid'
    return problems
}

export const BRAND_ICON_ACCEPT = 'image/png,image/jpeg,image/webp'
export const BRAND_ICON_MIN = 512

export type IconProblem = { kind: 'type' | 'notSquare' | 'tooSmall' | 'tooLarge' | 'unreadable'; width: number; height: number }

export function iconProblem(file: { type: string; size: number }, width: number, height: number): IconProblem | null {
    const problem = (kind: IconProblem['kind']) => ({ kind, width, height })
    if (!BRAND_ICON_ACCEPT.split(',').includes(file.type)) return problem('type')
    if (file.size > LOGO_MAX_BYTES) return problem('tooLarge')
    if (width !== height) return problem('notSquare')
    if (width < BRAND_ICON_MIN) return problem('tooSmall')
    return null
}

export async function readIcon(file: File): Promise<IconProblem | null> {
    const unread = iconProblem(file, BRAND_ICON_MIN, BRAND_ICON_MIN)
    if (unread) return unread
    try {
        const { width, height } = await createImageBitmap(file)
        return iconProblem(file, width, height)
    } catch {
        return { kind: 'unreadable', width: 0, height: 0 }
    }
}
