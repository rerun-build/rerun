import { z } from 'zod'

export const CLIENT_HEADER = 'x-rerun-client'

export const CLIENT_PLATFORMS = ['ios', 'android'] as const
export const clientPlatformSchema = z.enum(CLIENT_PLATFORMS)
export type ClientPlatform = z.infer<typeof clientPlatformSchema>

export type ClientIdentity = { platform: ClientPlatform; version: string; build: number }

export function formatClientHeader({ platform, version, build }: ClientIdentity): string {
    return `${platform}/${version} (${build})`
}

const CLIENT_HEADER_PATTERN = new RegExp(`^(${CLIENT_PLATFORMS.join('|')})/([^ ]+) \\((\\d+)\\)$`)

export function parseClientHeader(header: string | null | undefined): ClientIdentity | null {
    const match = CLIENT_HEADER_PATTERN.exec(header ?? '')
    if (!match) return null
    return { platform: match[1] as ClientPlatform, version: match[2], build: Number(match[3]) }
}

export const clientServerSchema = z.object({
    supabaseUrl: z.url(),
    supabasePublishableKey: z.string().min(1),
})
export type ClientServer = z.infer<typeof clientServerSchema>

export const clientConfigSchema = z.object({
    minBuild: z.number().int().nonnegative(),
    server: clientServerSchema.optional(),
})
export type ClientConfig = z.infer<typeof clientConfigSchema>
