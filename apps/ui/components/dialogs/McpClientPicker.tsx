'use client'

import { ProviderIcon } from '@/lib/engine/provider-icons'
import { PlugIcon } from '@/lib/icons'
import { MCP_CLIENTS, type McpClientId } from '@/lib/mcp/connect'
import { cn } from '@/lib/utils'

const CLIENT_PROVIDERS: Record<McpClientId, string | null> = {
    'claude-code': 'claude',
    chatgpt: 'openai',
    cursor: 'cursor',
    rerun: 'rerun',
    other: null,
}

export function McpClientPicker({ value, onChange, className }: { value: McpClientId; onChange: (client: McpClientId) => void; className?: string }) {
    return (
        <div className={cn('flex flex-wrap gap-1.5', className)}>
            {MCP_CLIENTS.map(client => {
                const active = client.id === value
                const provider = CLIENT_PROVIDERS[client.id]
                return (
                    <button
                        key={client.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(client.id)}
                        className={cn(
                            'flex h-7 items-center gap-1.5 rounded-md border bg-background/40 px-2.5 text-xs font-medium transition-colors',
                            'text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                            active && 'border-primary/40 text-primary ring-1 ring-primary/40',
                        )}
                    >
                        {provider ? <ProviderIcon provider={provider} className="size-3.5 shrink-0" /> : <PlugIcon className="size-3.5 shrink-0" />}
                        {client.label}
                    </button>
                )
            })}
        </div>
    )
}
