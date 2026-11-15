'use client'

import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import { useBillingStore } from '@/stores/billing.store'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { track } from '@rerun/analytics/client'
import type { LibraryTemplate } from '@/lib/templates/library'

export function useTemplateImportFlow({ onDone }: { onDone: () => void }) {
    const { workspace } = useSession()
    const openBilling = useBillingStore(s => s.openBilling)
    const beginTemplatePlacement = useBoardStore(s => s.beginTemplatePlacement)
    const spaces = useBoardStore(s => s.spaces)

    function run(template: LibraryTemplate, { again = false }: { again?: boolean } = {}) {
        if (!workspace) return

        const installed = again ? undefined : useBoardStore.getState().agents.find(agent => agent.templateId === template.id)
        if (installed) {
            useBoardStore.getState().openAgentChat(installed.id)
            onDone()
            return
        }

        const hasSpace = spaces.length > 0
        if (hasSpace) {
            if (!isSubscriptionEntitled(workspace.subscription_status)) {
                openBilling(undefined, 'template_link')
                return
            }
        } else {
            track('first_agent_created', { template: template.slug })
        }

        track('template_link_opened', { slug: template.slug, has_space: hasSpace })
        beginTemplatePlacement({ slug: template.slug, title: template.title, agentNames: template.archiveAgentNames, again })
        onDone()
    }

    return { run }
}
