'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { inOrganizationTeamAction } from '@/ee/actions/organization-entry.actions'
import { CONSOLE_HOME } from '@/ee/lib/organizations/console-routes'
import { Building2 } from '@/lib/icons'
import { useSession } from '@/supabase/session/SessionProvider'

const answers = new Map<string, boolean>()
const storageKey = (userId: string) => `rerun:organization-team:${userId}`

function remembered(userId: string): boolean {
    try {
        return answers.get(userId) ?? localStorage.getItem(storageKey(userId)) === '1'
    } catch {
        return false
    }
}

function remember(userId: string, inTeam: boolean): void {
    answers.set(userId, inTeam)
    try {
        if (inTeam) localStorage.setItem(storageKey(userId), '1')
        else localStorage.removeItem(storageKey(userId))
    } catch {}
}

// Mounted with the menu, so it draws what this browser last knew, and asks once per page load behind it.
export function OrganizationMenuItem() {
    const t = useTranslations('organization.nav')
    const { user } = useSession()
    const userId = user?.id
    const [shown, setShown] = useState(() => !!userId && remembered(userId))

    useEffect(() => {
        if (!userId || answers.has(userId)) return
        let left = false
        inOrganizationTeamAction().then(
            inTeam => {
                remember(userId, inTeam)
                if (!left) setShown(inTeam)
            },
            () => {},
        )
        return () => {
            left = true
        }
    }, [userId])

    if (!shown) return null
    return (
        <DropdownMenuItem asChild className="gap-2 text-muted-foreground">
            <Link href={CONSOLE_HOME}>
                <Building2 className="size-4" />
                {t('label')}
            </Link>
        </DropdownMenuItem>
    )
}
