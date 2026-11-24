'use client'

import type { ResumeChat } from '@rerun/contracts'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { MonitorIcon, Smartphone, XIcon } from '@/lib/icons'

type ResumeChatPillProps = {
    resume: ResumeChat | null
    onContinue: (sessionId: string, title: string) => void
    onDismiss: () => void
}

// The conversation left open on another device, offered over the composer rather than opened by itself.
export function ResumeChatPill({ resume, onContinue, onDismiss }: ResumeChatPillProps) {
    const t = useTranslations('agent.resumeChat')
    const DeviceIcon = resume?.deviceKind === 'phone' ? Smartphone : MonitorIcon
    const title = resume?.title ?? t('untitled')
    return (
        <AnimatePresence>
            {resume && (
                <motion.div key={resume.changedAt} className="flex min-w-0 shrink-0 justify-center px-3 pb-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.25 }}>
                    <div className="flex h-10 max-w-full items-center gap-1 rounded-full border border-border/50 bg-background/85 pe-1 ps-1.5 shadow-sm backdrop-blur-xl">
                        <button type="button" onClick={() => onContinue(resume.sessionId, title)} className="flex h-8 min-w-0 items-center gap-2 rounded-full px-2 text-sm transition-colors hover:bg-accent">
                            <DeviceIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="flex min-w-0 gap-2">
                                {t.rich('continue', {
                                    title,
                                    verb: chunks => <span className="shrink-0 text-muted-foreground">{chunks}</span>,
                                    name: chunks => <span dir="auto" className="truncate font-medium">{chunks}</span>,
                                })}
                            </span>
                        </button>
                        <Button aria-label={t('dismiss')} variant="ghost" size="icon-sm" className="shrink-0 rounded-full" onClick={onDismiss}>
                            <XIcon className="size-3.5" />
                        </Button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
