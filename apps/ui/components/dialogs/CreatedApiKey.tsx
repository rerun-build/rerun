'use client'

import { CopyLine } from '@/components/dialogs/CopyLine'
import { McpSnippets } from '@/components/dialogs/McpSnippets'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CircleCheckIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

// The only moment the full key exists on the client: the database keeps its hash and nothing else.
// So the snippets here carry the real key rather than the placeholder, and the block takes the
// success Alert with its green beam — nothing else in the dialog moves.
export function CreatedApiKey({ value, mcpUrl, onDismiss }: { value: string; mcpUrl: string; onDismiss: () => void }) {
    const t = useTranslations('dialogs.apiKeys.created')
    return (
        <Alert variant="success" className="min-w-0 gap-3 p-3">
            <p className="flex items-center gap-2 text-sm text-emerald-500">
                <CircleCheckIcon className="size-4 shrink-0" />
                {t('warning')}
            </p>
            <CopyLine value={value} label={t('copyKey')} />
            <McpSnippets mcpUrl={mcpUrl} apiKey={value} />
            <div>
                <Button size="sm" variant="ghost" onClick={onDismiss}>
                    {t('dismiss')}
                </Button>
            </div>
        </Alert>
    )
}
