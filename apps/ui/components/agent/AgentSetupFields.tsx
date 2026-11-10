'use client'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { MarkdownTextarea } from '@/components/ui/markdown-textarea'
import { Wand2 } from '@/lib/icons'
import { DEFAULT_INSTALL_PROMPT } from '@/lib/templates/install-template'
import { useTranslations } from 'next-intl'

export type AgentSetupDraft = { required: boolean | null; prompt: string }

// The same two fields are answered in two places: on the agent itself, and again in the capture
// review right before the archive is built. One component so the wording, and what "yes" implies,
// cannot drift between them.
export function AgentSetupFields({ value, onChange, disabled }: { value: AgentSetupDraft; onChange: (next: AgentSetupDraft) => void; disabled?: boolean }) {
    const t = useTranslations('agent.agentSetupFields')
    const choices = [
        { value: 'yes', label: t('yes') },
        { value: 'no', label: t('no') },
    ]
    const prompt = value.prompt.trim()
    const isDefault = prompt === DEFAULT_INSTALL_PROMPT.trim()
    const useDefaultTemplate = () => onChange({ ...value, prompt: DEFAULT_INSTALL_PROMPT })

    const resetButton = (
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={prompt ? undefined : useDefaultTemplate} className="self-start">
            <Wand2 className="mr-1.5 size-3.5" />
            {prompt ? t('resetToDefault') : t('useDefault')}
        </Button>
    )

    return (
        <div className="flex flex-col gap-3">
            <Field label={t('needsSetup.label')} helperText={t('needsSetup.helper')}>
                <Segmented
                    options={choices}
                    value={value.required === null ? '' : value.required ? 'yes' : 'no'}
                    // Saying yes in front of an empty field means starting from the default rather
                    // than from a blank page. An answer already written is never overwritten.
                    onChange={next => {
                        const required = next === 'yes'
                        onChange({ required, prompt: required && !prompt ? DEFAULT_INSTALL_PROMPT : value.prompt })
                    }}
                    className={disabled ? 'pointer-events-none opacity-60' : undefined}
                />
            </Field>

            {value.required === true && (
                <Field label={t('instructions.label')} helperText={t('instructions.helper')}>
                    <div className="flex flex-col gap-1.5">
                        <MarkdownTextarea
                            dialogTitle={t('instructions.dialogTitle')}
                            disabled={disabled}
                            value={value.prompt}
                            onChange={prompt => onChange({ ...value, prompt })}
                            placeholder={DEFAULT_INSTALL_PROMPT}
                            className="min-h-40 font-mono text-xs"
                        />
                        {!isDefault &&
                            (prompt ? (
                                <ConfirmDialog
                                    title={t('resetConfirm.title')}
                                    description={t('resetConfirm.description')}
                                    confirmLabel={t('resetConfirm.confirm')}
                                    confirmVariant="default"
                                    onConfirm={useDefaultTemplate}
                                >
                                    {resetButton}
                                </ConfirmDialog>
                            ) : (
                                resetButton
                            ))}
                    </div>
                </Field>
            )}
        </div>
    )
}
