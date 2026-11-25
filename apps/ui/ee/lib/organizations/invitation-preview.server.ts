import 'server-only'
import type { Brand } from '@rerun/contracts'
import { renderEmail, WorkspaceInvite } from '@rerun/emails'
import { isStableLocale } from '@rerun/i18n'
import { createElement } from 'react'

import { INVITED_WORKSPACE } from '@/ee/lib/organizations/invitation-preview'
import { brandAppUrl } from '@/lib/brand/urls'

// The invitation a client's admin receives, as it leaves: nobody of the agency is named in it.
export async function renderInvitationPreview(brand: Brand, locale: string): Promise<string> {
    const appUrl = brandAppUrl(brand)
    const { html } = await renderEmail(createElement(WorkspaceInvite, { workspaceName: INVITED_WORKSPACE, inviteUrl: appUrl, appUrl, locale: isStableLocale(locale) ? locale : undefined, brand }))
    return html
}
