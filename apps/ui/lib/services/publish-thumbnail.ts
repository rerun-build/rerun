import 'server-only'
import { after } from 'next/server'
import { captureThumbnail } from '@/lib/published/thumbnail'
import { hubBaseUrl } from '@/lib/services/hub'
import { publishFile, type PublishOptions } from '@/lib/services/publish'
import type { PublishResult } from '@/lib/services/types'

export { listPublished, unpublishFile } from '@/lib/services/publish'

// The capture takes seconds and the coworker is waiting on the URL: it runs once the answer is out.
export async function publishWithThumbnail(agentId: string, path: string, customSlug?: string, options?: PublishOptions): Promise<PublishResult> {
    const result = await publishFile(agentId, path, customSlug, options)
    after(() => captureThumbnail(result.slug, hubBaseUrl()))
    return result
}
