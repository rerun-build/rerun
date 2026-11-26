import { z } from 'zod'

export const publishedAccessModeSchema = z.enum(['public', 'workspace', 'password', 'invited'])
export type PublishedAccessMode = z.infer<typeof publishedAccessModeSchema>

// A link a coworker published, as the chat's card reads it again: the tool output only tells what the
// link was at the time of the call. `requestedAccess` is 'public' while a person still has to approve
// the public link the coworker asked for.
export const publishedLinkSchema = z.object({
    slug: z.string(),
    url: z.string(),
    path: z.string(),
    kind: z.enum(['file', 'site']),
    contentType: z.string(),
    title: z.string(),
    access: publishedAccessModeSchema,
    requestedAccess: z.literal('public').nullable(),
    thumbnailUrl: z.string().nullable(),
    // The capture is taken after the publish answers: a link updated a moment ago may still get one.
    updatedAt: z.string(),
})
export type PublishedLink = z.infer<typeof publishedLinkSchema>

// `file` is null once the link was unpublished, or is out of the person's reach.
export const publishedLinkReadSchema = z.object({ file: publishedLinkSchema.nullable() })

// The app settles only the public link a coworker asked for: the other modes stay on the web.
export const makePublishedPublicSchema = z.object({ access: z.literal('public') })

export const publishedLinkChangedSchema = z.object({ file: publishedLinkSchema })

// A link as a card names it: its host, and its path when it has one.
export function publishedHostOf(url: string): string {
    try {
        const { host, pathname } = new URL(url)
        return pathname === '/' ? host : `${host}${pathname}`
    } catch {
        return url
    }
}
