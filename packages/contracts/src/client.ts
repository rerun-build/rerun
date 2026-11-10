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

// Null for a header this hub cannot read, and for none at all: the iOS builds from before the header
// send nothing.
export function parseClientHeader(header: string | null | undefined): ClientIdentity | null {
    const match = CLIENT_HEADER_PATTERN.exec(header ?? '')
    if (!match) return null
    return { platform: match[1] as ClientPlatform, version: match[2], build: Number(match[3]) }
}

// The Supabase project a hub signs people in with, as a phone reaches it. Optional because hubs from
// before self-hosted servers could be picked in the app do not send it.
export const clientServerSchema = z.object({
    supabaseUrl: z.url(),
    supabasePublishableKey: z.string().min(1),
})
export type ClientServer = z.infer<typeof clientServerSchema>

// A binary older than minBuild cannot follow the hub any more and must be updated from its store. The
// hub answers with the minimum of the platform the `x-rerun-client` header names.
export const clientConfigSchema = z.object({
    minBuild: z.number().int().nonnegative(),
    server: clientServerSchema.optional(),
})
export type ClientConfig = z.infer<typeof clientConfigSchema>
