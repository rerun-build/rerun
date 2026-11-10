'use client'

import { CopyBlock } from '@/components/dialogs/CopyBlock'
import { CopyLine } from '@/components/dialogs/CopyLine'
import { McpClientPicker } from '@/components/dialogs/McpClientPicker'
import { DocsLink } from '@/components/ui/docs-link'
import { Field } from '@/components/ui/field'
import { KEY_PLACEHOLDER, mcpClientDocs, mcpClientSnippets, type McpClientId } from '@/lib/mcp/connect'
import { Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

// What to paste for the client at hand. Without a key it falls back to the placeholder, so the
// panel is readable before anyone has created one.
export function McpSnippets({ mcpUrl, apiKey = KEY_PLACEHOLDER }: { mcpUrl: string; apiKey?: string }) {
    const t = useTranslations('dialogs.copy')
    const [client, setClient] = useState<McpClientId>('claude-code')

    return (
        <div className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-muted/20">
            <div className="relative overflow-hidden border-b border-border/60 bg-muted/30 px-3 py-2.5">
                <Stripes />
                <McpClientPicker value={client} onChange={setClient} className="relative" />
            </div>

            <div className="space-y-2.5 p-3">
                {mcpClientSnippets(client, mcpUrl, apiKey).map(snippet => (
                    <Field key={snippet.label} label={snippet.label} helperText={snippet.hint}>
                        {snippet.block ? <CopyBlock value={snippet.value} label={t('snippet', { label: snippet.label })} /> : <CopyLine value={snippet.value} label={t('snippet', { label: snippet.label })} />}
                    </Field>
                ))}

                <DocsLink path={mcpClientDocs(client)}>{t('fullGuide')}</DocsLink>
            </div>
        </div>
    )
}
