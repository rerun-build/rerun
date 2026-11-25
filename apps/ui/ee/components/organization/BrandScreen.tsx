'use client'

import { useRouter } from 'next/navigation'

import { loadOrganizationBrandAction, updateOrganizationBrandAction } from '@/ee/actions/organization.actions'
import type { OrganizationBrandSettings } from '@/ee/services/organization-settings.service'

import { BrandView } from './BrandView'
import { useWriteBlock } from './ConsoleProvider'
import type { BrandFields } from './types'
import { useConsoleChange } from './useConsoleChange'
import { useConsoleData } from './useConsoleData'

function formOf(fields: BrandFields, icon: File | null): FormData {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.append(key, value)
    if (icon) form.append('icon', icon)
    return form
}

export function BrandScreen({ initial }: { initial: OrganizationBrandSettings }) {
    const router = useRouter()
    const block = useWriteBlock('owner')
    const { data, reload } = useConsoleData(initial, loadOrganizationBrandAction)
    const { submit } = useConsoleChange(reload)

    return (
        <BrandView
            {...data}
            block={block}
            onSave={async (fields, icon) => {
                const result = await submit(() => updateOrganizationBrandAction(formOf(fields, icon)))
                // The console wears the brand too.
                if (result.ok) router.refresh()
                return result
            }}
        />
    )
}
