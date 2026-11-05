'use client'

import { useEffect, useState } from 'react'

import { getPublishSettingsAction, type PublishSettings } from '@/app/api/_actions/publish.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Field } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import type { PublishPolicy } from '@/lib/published/access'
import { CheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

function policyOptions(workspaceName: string): { value: PublishPolicy; title: string; hint: string }[] {
    return [
        { value: 'people', title: 'Only people can make a link public', hint: `Coworkers publish for ${workspaceName} and ask before going public` },
        { value: 'anyone', title: 'Coworkers can make a link public', hint: 'They pick the access themselves' },
        { value: 'never', title: 'Nothing goes public', hint: 'Workspace, password and invited links only' },
    ]
}

// The policy as the workspace holds it, and the one picked in the form until it is saved.
export function usePublishPolicyDraft(enabled: boolean) {
    const [settings, setSettings] = useState<PublishSettings | null>(null)
    const [draft, setDraft] = useState<PublishPolicy | null>(null)

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        void getPublishSettingsAction().then(loaded => {
            if (cancelled) return
            setSettings(loaded)
            setDraft(loaded?.policy ?? null)
        })
        return () => {
            cancelled = true
        }
    }, [enabled])

    return { settings, draft, setDraft, changed: !!settings && !!draft && draft !== settings.policy }
}

export function PublishPolicyField({ value, onChange, publicLinks, workspaceName }: { value: PublishPolicy | null; onChange: (policy: PublishPolicy) => void; publicLinks: number; workspaceName: string }) {
    const [confirmingNever, setConfirmingNever] = useState(false)

    const pick = (policy: PublishPolicy) => {
        if (policy === 'never' && value !== 'never' && publicLinks > 0) return setConfirmingNever(true)
        onChange(policy)
    }

    return (
        <Field label="Public links">
            <div className="flex flex-col gap-1.5">
                {value === null
                    ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-lg" />)
                    : policyOptions(workspaceName).map(option => {
                          const selected = value === option.value
                          return (
                              <button
                                  key={option.value}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() => pick(option.value)}
                                  className={cn('flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors', selected ? 'border-primary/40 ring-1 ring-primary/40' : 'border-border hover:border-foreground/20')}
                              >
                                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                      <span className="text-sm">{option.title}</span>
                                      <span className="text-xs text-muted-foreground">{option.hint}</span>
                                  </span>
                                  <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                                      {selected && <CheckIcon className="size-2.5" />}
                                  </span>
                              </button>
                          )
                      })}
            </div>
            {confirmingNever && (
                <ConfirmDialog
                    open
                    onOpenChange={next => !next && setConfirmingNever(false)}
                    title="Turn off public links?"
                    description={`${publicLinks} public ${publicLinks === 1 ? 'link' : 'links'} will switch to ${workspaceName} members once you save.`}
                    confirmLabel="Turn off"
                    onConfirm={() => {
                        setConfirmingNever(false)
                        onChange('never')
                    }}
                />
            )}
        </Field>
    )
}
