'use client'

import * as React from 'react'
import type { TemplateBrief } from '@/lib/templates/describe'
import type { TemplateImageFolder } from '@/lib/templates/images'
import type { AltTextResult, ContentPrefillResult, FaqPrefillResult, MetaPrefillResult, UploadResult } from '@/lib/templates/authoring'

export type TemplateAuthoringActions = {
    uploadImage: (formData: FormData, folder: TemplateImageFolder) => Promise<UploadResult>
    prefillContent: (brief: TemplateBrief) => Promise<ContentPrefillResult>
    prefillMeta: (brief: TemplateBrief) => Promise<MetaPrefillResult>
    prefillFaq: (input: { brief: TemplateBrief; longDescription: string }) => Promise<FaqPrefillResult>
    prefillAltText: (input: { brief: TemplateBrief; imageUrl: string; isCover: boolean }) => Promise<AltTextResult>
}

export type TemplateAuthoringScope = 'admin' | 'author'

type TemplateAuthoringContext = { scope: TemplateAuthoringScope; actions: TemplateAuthoringActions; payoutsReady: boolean }

const Context = React.createContext<TemplateAuthoringContext | null>(null)

type ProviderProps = Omit<TemplateAuthoringContext, 'payoutsReady'> & { payoutsReady?: boolean; children: React.ReactNode }

export function TemplateAuthoringProvider({ scope, actions, payoutsReady = true, children }: ProviderProps) {
    const value = React.useMemo(() => ({ scope, actions, payoutsReady }), [scope, actions, payoutsReady])
    return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useTemplateAuthoring(): TemplateAuthoringContext {
    const context = React.useContext(Context)
    if (!context) throw new Error('Template authoring sections must be mounted inside a TemplateAuthoringProvider')
    return context
}
