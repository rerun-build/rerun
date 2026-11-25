import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'

import { NewWorkspaceScreen } from '@/ee/components/organization/NewWorkspaceScreen'
import { renderInvitationPreview } from '@/ee/lib/organizations/invitation-preview.server'
import { openConsole } from '@/ee/lib/organizations/console.server'
import { brandOfOrganization } from '@/ee/services/organization-brand.service'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('organization.create')
    return { title: t('title') }
}

export default async function NewWorkspacePage() {
    const { supabase, organization } = await openConsole()
    const brand = await brandOfOrganization(supabase, organization)
    return <NewWorkspaceScreen email={await renderInvitationPreview(brand, await getLocale())} />
}
