import 'server-only'
import { getBlobByFile } from '@/lib/blobs/catalog'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'
import { uploadPublicImage } from '@/lib/images/upload'
import { fetchLogoBytes, rasterizeVectorLogo } from '@/lib/workspace/fetch-logo'
import { LOGO_MAX_BYTES, logoLinkImageUrl, readLogoLink } from '@/lib/workspace/logo-input'
import { createServiceRoleClient } from '@/supabase/serviceRole'

// The logo of a workspace form: a catalogue file name, an uploaded file or a link, never a URL to
// store. Answers no `iconUrl` when the form brings none.
const WORKSPACE_LOGOS_BUCKET = 'workspace-logos'
const WORKSPACE_LOGO_MAX_SIZE = 256

export async function readWorkspaceLogo(formData: FormData, workspaceId: number): Promise<{ ok: true; iconUrl?: string } | ActionFailure> {
    const iconFile = formData.get('iconFile')
    if (typeof iconFile === 'string' && iconFile) {
        const icon = getBlobByFile(iconFile)
        return icon ? { ok: true, iconUrl: icon.url } : failure('unknownIcon')
    }

    const logoFile = formData.get('logoFile')
    if (logoFile instanceof File) {
        if (!logoFile.type.startsWith('image/')) return failure('chooseImage')
        if (logoFile.size > LOGO_MAX_BYTES) return failure('imageTooLarge', { max: LOGO_MAX_BYTES / (1024 * 1024) })
        return rehostLogo(await logoFile.arrayBuffer(), workspaceId)
    }

    const logoLink = formData.get('logoLink')
    if (typeof logoLink === 'string' && logoLink.trim()) {
        const link = readLogoLink(logoLink)
        if (!link) return failure('noLogoFound')
        const fetched = await fetchLogoBytes(logoLinkImageUrl(link))
        if (!fetched.ok) return fetched
        return rehostLogo(fetched.bytes, workspaceId)
    }

    return { ok: true }
}

async function rehostLogo(bytes: ArrayBuffer | Uint8Array, workspaceId: number): Promise<{ ok: true; iconUrl: string } | ActionFailure> {
    try {
        const raster = await rasterizeVectorLogo(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), WORKSPACE_LOGO_MAX_SIZE)
        const iconUrl = await uploadPublicImage(createServiceRoleClient(), raster, WORKSPACE_LOGOS_BUCKET, String(workspaceId), { maxSize: WORKSPACE_LOGO_MAX_SIZE })
        return { ok: true, iconUrl }
    } catch {
        return failure('imageUnreadable')
    }
}
