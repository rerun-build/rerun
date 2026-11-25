'use client'

import { loadWorkspaceBrandAction } from '@/app/api/_actions/workspace-brand.actions'
import { BrandProvider, useBrand } from '@/components/brand/BrandProvider'
import { useSession } from '@/supabase/session/SessionProvider'
import { isWhiteLabel, RERUN_BRAND, type Brand } from '@rerun/contracts'
import { useEffect, useState, type ReactNode } from 'react'

// A workspace carries the brand of the organization that runs it on every host it is opened from:
// what is Rerun's own (its support chat, its changelog, its offers) never shows there. `initial` is
// the brand of the workspace the page was rendered for, until the tab says which one it is on.
export function WorkspaceBrandProvider({ initial, children }: { initial: Brand; children: ReactNode }) {
    const hostBrand = useBrand()
    const { workspace } = useSession()
    const [loaded, setLoaded] = useState<Brand | null>(null)

    const organizationId = workspace ? (workspace.organization_id ?? null) : initial.organizationId
    const brand = isWhiteLabel(hostBrand) || organizationId === null ? hostBrand : [initial, loaded].find(candidate => candidate?.organizationId === organizationId)

    useEffect(() => {
        if (brand) return
        let cancelled = false
        void loadWorkspaceBrandAction()
            .then(read => {
                if (!cancelled) setLoaded(read)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [brand, organizationId])

    // Not read yet: already not Rerun's.
    return <BrandProvider brand={brand ?? { ...RERUN_BRAND, organizationId, name: '' }}>{children}</BrandProvider>
}
