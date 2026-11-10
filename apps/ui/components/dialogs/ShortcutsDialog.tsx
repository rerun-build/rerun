'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { useModKeyLabel } from '@/hooks/useModKeyLabel'
import { useShortcutsStore } from '@/stores/shortcuts.store'
import { useTranslations } from 'next-intl'

type ShortcutAction = 'controlCenter' | 'askRerun' | 'holdToTalk' | 'searchInPage' | 'newConversation' | 'closeTab' | 'sendMessage' | 'newLine' | 'previousFile' | 'nextFile'
type Shortcut = { keys: string[]; action: ShortcutAction }
type ShortcutGroup = { title: 'general' | 'chat' | 'files'; shortcuts: Shortcut[] }

function buildGroups(mod: string): ShortcutGroup[] {
    return [
        {
            title: 'general',
            shortcuts: [
                { keys: [mod, 'F'], action: 'controlCenter' },
                { keys: [mod, 'K'], action: 'askRerun' },
                { keys: ['Space'], action: 'holdToTalk' },
                { keys: [mod, 'F', '×2'], action: 'searchInPage' },
            ],
        },
        {
            title: 'chat',
            shortcuts: [
                { keys: [mod, 'K'], action: 'newConversation' },
                { keys: [mod, '⌫'], action: 'closeTab' },
                { keys: ['Enter'], action: 'sendMessage' },
                { keys: ['Shift', 'Enter'], action: 'newLine' },
            ],
        },
        {
            title: 'files',
            shortcuts: [
                { keys: ['←'], action: 'previousFile' },
                { keys: ['→'], action: 'nextFile' },
            ],
        },
    ]
}

export function ShortcutsDialog() {
    const t = useTranslations('dialogs.shortcuts')
    const { open, setOpen } = useShortcutsStore()
    const mod = useModKeyLabel()

    const groups = buildGroups(mod)

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription>{t('description')}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-5 py-2">
                    {groups.map(group => (
                        <div key={group.title} className="flex flex-col gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`groups.${group.title}`)}</span>
                            <div className="flex flex-col gap-1.5">
                                {group.shortcuts.map((sc, i) => (
                                    <div key={i} className="flex items-center justify-between gap-4">
                                        <span className="text-sm text-foreground">{t(`actions.${sc.action}`)}</span>
                                        <span className="flex items-center gap-1">
                                            {sc.keys.map((k, j) => (
                                                <Kbd key={j}>{k}</Kbd>
                                            ))}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}
