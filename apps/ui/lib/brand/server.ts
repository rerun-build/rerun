import 'server-only'
import { loadPublished } from '@/lib/published/gate'
import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { requestSite } from './request-site'
import { workspaceBrand } from './workspace'

// The brand of the request. A host that is nobody's has none: the proxy already answered it, and what
// it does not see answers the same.
export const getBrand = cache(async (): Promise<Brand> => {
    const site = await requestSite()
    if (site.kind === 'organization') return site.brand
    if (site.kind === 'unknown') notFound()
    if (site.kind === 'rerun') return RERUN_BRAND
    const entry = await loadPublished(site.slug)
    return entry ? workspaceBrand(entry.workspace_id) : RERUN_BRAND
})
