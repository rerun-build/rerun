import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PreviewScreen } from '@/ee/components/organization/preview/PreviewScreen'
import { PREVIEW_SURFACES } from '@/ee/lib/organizations/console-routes'
import { openConsole } from '@/ee/lib/organizations/console.server'
import { brandOfOrganization } from '@/ee/services/organization-brand.service'

export const metadata: Metadata = { robots: { index: false, follow: false } }

type PreviewPageProps = { params: Promise<{ surface: string }>; searchParams: Promise<{ theme?: string | string[] }> }

export default async function PreviewPage({ params, searchParams }: PreviewPageProps) {
    const { supabase, organization } = await openConsole()
    const asked = (await params).surface
    const surface = PREVIEW_SURFACES.find(candidate => candidate === asked)
    if (!surface) notFound()
    return <PreviewScreen surface={surface} theme={(await searchParams).theme === 'dark' ? 'dark' : 'light'} brand={await brandOfOrganization(supabase, organization)} />
}
