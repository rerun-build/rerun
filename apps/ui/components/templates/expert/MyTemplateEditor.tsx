'use client'

import { ScrollFade } from '@rerun/ui/primitives'
import * as React from 'react'
import { useTranslations } from 'next-intl'
import { type FieldErrors, FormProvider, useForm } from 'react-hook-form'
import { TemplateAuthoringProvider } from '@/components/templates/authoring/actions-context'
import { TemplateContentSection } from '@/components/templates/authoring/TemplateContentSection'
import { TemplateFaqSection } from '@/components/templates/authoring/TemplateFaqSection'
import { TemplateMediaSection } from '@/components/templates/authoring/TemplateMediaSection'
import { TemplateMetaSection } from '@/components/templates/authoring/TemplateMetaSection'
import { TemplatePricingSection } from '@rerun/cloud/marketplace.client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { templateFormResolver, type TemplateFormValues } from '@/lib/templates/edit-schema'
import { templateAuthorSchema, templateEditBlockReason, type ExpertTemplateDetail, type TemplateAuthorInput } from '@/lib/templates/expert'
import { expertAuthoringActions } from './expertAuthoringActions'
import { ExpertTemplateAgents } from './ExpertTemplateAgents'
import { TemplateSubmitFooter } from './TemplateSubmitFooter'

const EDITOR_TABS = ['details', 'pricing', 'media', 'faq', 'agents'] as const

type TemplateEditorTab = (typeof EDITOR_TABS)[number]

const TAB_FIELDS = {
    details: ['slug', 'title', 'tagline', 'longDescription', 'category', 'tags', 'metaTitle', 'metaDescription', 'setupMinutes'],
    pricing: ['pricingModel', 'priceAmountCents'],
    media: ['gallery', 'videoUrl', 'ogImageUrl'],
    faq: ['faq'],
    agents: ['agents'],
} as const satisfies Record<TemplateEditorTab, readonly (keyof TemplateFormValues)[]>

function firstInvalidTab(errors: FieldErrors<TemplateFormValues>): TemplateEditorTab {
    return EDITOR_TABS.find(tab => TAB_FIELDS[tab].some(field => errors[field] !== undefined)) ?? 'details'
}

// The author's editor: the same sections as the admin console, over the same document, with the
// slug and the social card hidden by the `author` scope. The form holds the whole document rather
// than the author's slice of it, because that is what the sections and `toTemplateBrief` are typed
// against; the server merges only what it accepts back over the stored row.
export function MyTemplateEditor({
    template,
    payoutsReady,
    onSave,
    onSubmit,
    onWithdraw,
    onDelete,
    onCapture,
    onRemoveAgent,
}: {
    template: ExpertTemplateDetail
    payoutsReady: boolean
    onSave: (values: TemplateAuthorInput) => Promise<boolean>
    onSubmit: () => Promise<boolean>
    onWithdraw: () => Promise<boolean>
    onDelete: () => Promise<boolean>
    onCapture: () => void
    onRemoveAgent: (agentKey: string) => Promise<boolean>
}) {
    const t = useTranslations('templates.expert.tabs')
    const readOnly = templateEditBlockReason(template.status) !== null
    const actions = React.useMemo(() => expertAuthoringActions(template.id), [template.id])
    const [activeTab, setActiveTab] = React.useState<TemplateEditorTab>('details')

    const form = useForm<TemplateFormValues, unknown, TemplateFormValues>({
        resolver: templateFormResolver,
        defaultValues: template.document,
    })
    const {
        formState: { isSubmitting },
    } = form

    // A capture writes `agents` straight to the row, so the reloaded document is the only place the
    // new list exists: the form was seeded once at mount and would otherwise keep showing the old one.
    React.useEffect(() => {
        form.reset(current => ({ ...current, agents: template.document.agents }))
    }, [form, template.document.agents])

    // Parsed rather than hand-picked: the schema is the list of what an author may send, and the
    // server re-parses the same one on the way in.
    const save = form.handleSubmit(
        async values => {
            if (await onSave(templateAuthorSchema.parse(values))) form.reset(values)
        },
        errors => setActiveTab(firstInvalidTab(errors)),
    )

    return (
        <FormProvider {...form}>
            <TemplateAuthoringProvider scope="author" actions={actions} payoutsReady={payoutsReady}>
                <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
                    <Tabs value={activeTab} onValueChange={value => setActiveTab(value as TemplateEditorTab)} className="min-h-0 flex-1">
                        <div className="shrink-0 overflow-x-auto border-b border-border">
                            <TabsList className="h-12 w-full min-w-max px-5">
                                {EDITOR_TABS.map(tab => (
                                    <TabsTrigger key={tab} value={tab} className="min-w-20 flex-1">
                                        {t(tab)}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </div>

                        <ScrollFade className="min-h-0 flex-1 px-5 pb-5">
                            {/* These stay mounted so tab changes cannot reset editor, field-array or upload state. */}
                            <TabsContent forceMount value="details">
                                <fieldset disabled={readOnly || isSubmitting} className="flex flex-col gap-5 pt-5">
                                    <TemplateMetaSection />
                                    <TemplateContentSection />
                                </fieldset>
                            </TabsContent>

                            <TabsContent forceMount value="pricing">
                                <fieldset disabled={readOnly || isSubmitting} className="pt-5">
                                    <TemplatePricingSection />
                                </fieldset>
                            </TabsContent>

                            <TabsContent forceMount value="media">
                                <fieldset disabled={readOnly || isSubmitting} className="pt-5">
                                    <TemplateMediaSection />
                                </fieldset>
                            </TabsContent>

                            <TabsContent forceMount value="faq">
                                <fieldset disabled={readOnly || isSubmitting} className="pt-5">
                                    <TemplateFaqSection />
                                </fieldset>
                            </TabsContent>

                            <TabsContent forceMount value="agents">
                                {/* Its own fieldset: capturing writes the row directly, and a save in flight is
                                    replaying a document read before that write, so it would put a removed coworker
                                    back. Kept out of the editorial fieldset so `readOnly` stays the block's call. */}
                                <fieldset disabled={isSubmitting} className="pt-5">
                                    <ExpertTemplateAgents agents={template.agents} readOnly={readOnly} onCapture={onCapture} onRemove={onRemoveAgent} />
                                </fieldset>
                            </TabsContent>
                        </ScrollFade>
                    </Tabs>

                    <TemplateSubmitFooter
                        status={template.status}
                        reviewNote={template.reviewNote}
                        payoutsReady={payoutsReady}
                        saving={isSubmitting}
                        onSubmit={onSubmit}
                        onWithdraw={onWithdraw}
                        onDelete={onDelete}
                    />
                </form>
            </TemplateAuthoringProvider>
        </FormProvider>
    )
}
