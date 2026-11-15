import { placeholderPhone, realEmail } from '@/lib/auth/placeholder-email'

type CrispCommand = [string, string, unknown[]?]

function crisp(): CrispCommand[] | undefined {
    return (window as Window & { $crisp?: CrispCommand[] }).$crisp
}

function identify(email: string | null | undefined, data: Record<string, string> = {}) {
    const address = realEmail(email)
    const phone = placeholderPhone(email)
    if (address) crisp()?.push(['set', 'user:email', [address]])
    else if (phone) crisp()?.push(['set', 'user:phone', [phone]])
    const entries = Object.entries(data)
    if (entries.length) crisp()?.push(['set', 'session:data', [entries]])
}

export function openCrisp(email?: string | null) {
    identify(email)
    crisp()?.push(['do', 'chat:show'])
    crisp()?.push(['do', 'chat:open'])
}

export function sendToCrisp({ email, workspaceId, text }: { email: string | null | undefined; workspaceId: number | string | null | undefined; text: string }) {
    identify(email, workspaceId != null ? { workspace_id: String(workspaceId), source: 'foreman' } : { source: 'foreman' })
    crisp()?.push(['do', 'message:send', ['text', text]])
    openCrisp()
}
