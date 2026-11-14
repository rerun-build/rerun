import { createHmac, timingSafeEqual } from 'node:crypto'

import type { AgentStatus, BoardAgent } from '@rerun/ui/iso-grid'
import { z } from 'zod'

import { CARD_HEIGHT, CARD_THEME, CARD_THEMES, CARD_WIDTH } from './size'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rerun.build'

const AGENT_STATUSES = ['idle', 'working', 'waiting_human', 'error', 'offline'] as const satisfies readonly AgentStatus[]

const slugSchema = z.string().trim().min(1).max(64)

export const boardSceneSchema = z.object({
    agents: z
        .array(
            z.object({
                name: z.string().trim().min(1).max(40),
                status: z.enum(AGENT_STATUSES).optional(),
                connectors: z.array(slugSchema).max(10).optional(),
            }),
        )
        .min(1)
        .max(8),
    highlight: z.array(slugSchema).max(10).optional(),
})
export type BoardScene = z.input<typeof boardSceneSchema>

const dimensionSchema = z.coerce.number().int().min(200).max(2000)

const boardImageOptionsSchema = z.object({
    width: dimensionSchema.default(CARD_WIDTH),
    height: dimensionSchema.default(CARD_HEIGHT),
    theme: z.enum(CARD_THEMES).default(CARD_THEME),
    zoom: z.coerce.number().min(0.3).max(8).optional(),
    format: z.enum(['png', 'webp']).default('png'),
})
export type BoardImageOptions = z.input<typeof boardImageOptionsSchema>

export type BoardImageRequest = z.output<typeof boardImageOptionsSchema> & {
    scene: z.output<typeof boardSceneSchema>
    query: string
}

const PARAM_OF_OPTION = { width: 'w', height: 'h', theme: 'theme', zoom: 'zoom', format: 'format' } as const satisfies Record<keyof BoardImageOptions, string>
const SIGNED_PARAMS = ['scene', ...Object.values(PARAM_OF_OPTION)]

function getSecret(): string {
    const secret = process.env.BOARD_IMAGE_SECRET
    if (!secret) throw new Error('BOARD_IMAGE_SECRET is not set')
    return secret
}

function sign(query: string): string {
    return createHmac('sha256', getSecret()).update(query).digest('base64url')
}

export function signedBoardImageQuery(scene: BoardScene, options: BoardImageOptions = {}): string {
    boardImageOptionsSchema.parse(options)

    const params = new URLSearchParams()
    params.set('scene', Buffer.from(JSON.stringify(boardSceneSchema.parse(scene)), 'utf8').toString('base64url'))
    for (const [option, param] of Object.entries(PARAM_OF_OPTION)) {
        const value = options[option as keyof BoardImageOptions]
        if (value !== undefined) params.set(param, String(value))
    }
    params.sort()
    params.set('sig', sign(params.toString()))
    return params.toString()
}

export function boardImageUrl(scene: BoardScene, options: BoardImageOptions = {}, appUrl: string = APP_URL): string {
    return `${appUrl}/og/board?${signedBoardImageQuery(scene, options)}`
}

function readScene(raw: string | null) {
    if (!raw) return null
    try {
        const parsed = boardSceneSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

export function readBoardImageRequest(search: URLSearchParams): BoardImageRequest | null {
    const signature = search.get('sig')
    if (!signature) return null

    const signed = new URLSearchParams()
    for (const param of SIGNED_PARAMS) {
        const value = search.get(param)
        if (value !== null) signed.set(param, value)
    }
    signed.sort()

    const given = Buffer.from(signature)
    const expected = Buffer.from(sign(signed.toString()))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

    const scene = readScene(signed.get('scene'))
    const options = boardImageOptionsSchema.safeParse(Object.fromEntries(Object.entries(PARAM_OF_OPTION).map(([option, param]) => [option, signed.get(param) ?? undefined])))
    if (!scene || !options.success) return null

    signed.set('sig', signature)
    return { ...options.data, scene, query: signed.toString() }
}

export function boardAgentsOfScene(scene: BoardImageRequest['scene'], knownConnectorSlugs: ReadonlySet<string>): BoardAgent[] {
    const seen = new Map<string, number>()
    return scene.agents.map(agent => {
        const count = seen.get(agent.name) ?? 0
        seen.set(agent.name, count + 1)
        return {
            key: count === 0 ? agent.name : `${agent.name}#${count + 1}`,
            name: agent.name,
            status: agent.status,
            connectorSlugs: (agent.connectors ?? []).filter(slug => knownConnectorSlugs.has(slug)),
        }
    })
}
