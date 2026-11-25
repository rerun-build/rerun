'use client'

import { useTranslations } from 'next-intl'

import { addOrganizationDomainAction, checkOrganizationDomainAction, listOrganizationDomainsAction, removeOrganizationDomainAction } from '@/ee/actions/organization.actions'
import type { OrganizationDomain } from '@/ee/services/organization-domains.service'

import { addressOf } from './BrandScreenPreview'
import { consoleDomainOf } from './console-data'
import { useConsole, useWriteBlock } from './ConsoleProvider'
import { DomainsView } from './DomainsView'
import { useConsoleChange } from './useConsoleChange'
import { useConsoleData } from './useConsoleData'

type Domains = { defaultHostname: string | null; domains: OrganizationDomain[] }

export function DomainsScreen({ initial }: { initial: Domains }) {
    const t = useTranslations('organization.domains.problems')
    const { brand } = useConsole()
    const block = useWriteBlock('owner')
    const { data, expect, reload } = useConsoleData<Domains>(initial, listOrganizationDomainsAction)
    const { pending, run, submit, change } = useConsoleChange<string>(reload)

    return (
        <DomainsView
            brand={brand}
            defaultHostname={data.defaultHostname ?? addressOf(brand)}
            domains={data.domains.map(domain => consoleDomainOf(domain, problem => t(problem)))}
            checkingId={pending}
            block={block}
            onAdd={hostname => submit(() => addOrganizationDomainAction(hostname))}
            onCheck={({ id }) => void run(id, () => checkOrganizationDomainAction(id))}
            onRemove={({ id }) => {
                const undo = expect(current => ({ ...current, domains: current.domains.filter(domain => domain.id !== id) }))
                void change(() => removeOrganizationDomainAction(id), undo)
            }}
        />
    )
}
