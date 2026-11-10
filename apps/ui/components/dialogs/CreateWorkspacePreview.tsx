'use client'

import { accountLabel } from '@/lib/auth/placeholder-email'
import { getBlobByFile } from '@/lib/blobs/catalog'
import { useSession } from '@/supabase/session/SessionProvider'
import { cn } from '@/lib/utils'
import { BorderBeam } from '@rerun/ui'
import { useTranslations } from 'next-intl'

type Member = { email: string; owner?: boolean }

function initial(email: string): string {
    return email.trim().charAt(0).toUpperCase() || '?'
}

export function CreateWorkspacePreview({ name, iconFile, members }: { name: string; iconFile: string; members: string[] }) {
    const t = useTranslations('dialogs.createWorkspace.preview')
    const { session } = useSession()
    const ownerEmail = accountLabel(session?.user?.email) ?? t('you')
    const icon = getBlobByFile(iconFile)

    const roster: Member[] = [{ email: ownerEmail, owner: true }, ...members.map(email => ({ email }))]

    return (
        <div className="hidden h-full flex-col items-center justify-center border-l bg-muted/30 p-8 sm:flex">
            <div className="relative w-full max-w-xs rounded-2xl border bg-background p-6 shadow-sm">
                <BorderBeam pattern="arcs" tone="white" animated={false} glow angle={53} className="opacity-20" />

                <div className="flex flex-col items-center text-center">
                    <div className="size-20 overflow-hidden rounded-2xl bg-muted">
                        {icon ? (
                            <img src={icon.url} alt="" className="size-full object-cover transition-opacity duration-300" />
                        ) : (
                            <div className="size-full" />
                        )}
                    </div>

                    <p className={cn('mt-4 max-w-full truncate text-lg font-medium transition-colors', name ? 'text-foreground' : 'text-muted-foreground/50')}>
                        {name || t('namePlaceholder')}
                    </p>

                    <span className="mt-2 inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{t('solo')}</span>
                </div>

                <div className="mt-6 border-t pt-4">
                    <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('members')}</p>
                    <ul className="flex flex-col gap-2">
                        {roster.map(member => (
                            <li key={member.email} className="flex items-center gap-2.5">
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-medium text-foreground">{initial(member.email)}</span>
                                <span className="min-w-0 flex-1 truncate text-sm">{member.email}</span>
                                {member.owner && <span className="text-[11px] text-muted-foreground">{t('owner')}</span>}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    )
}
