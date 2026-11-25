import { placeholderPhone, realEmail } from '@/lib/auth/placeholder-email'

type CrispCommand = [string, string, unknown[]?]

type CrispWindow = Window & { $crisp?: CrispCommand[]; CRISP_TOKEN_ID?: string | null }

function crisp(): CrispCommand[] | undefined {
    return (window as CrispWindow).$crisp
}

// Crisp only knows the visitor by what it is told: without the email, the team reads an anonymous
// conversation it cannot match to an account nor answer once the tab is closed. An account born
// from a phone is told by its number: Crisp refuses its placeholder address and shows the visitor
// an "invalid email" alert.
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

// Sent rather than left in the composer: the team is told the moment they asked, whether or not
// they stay on the chat that opens.
export function sendToCrisp({ email, workspaceId, text }: { email: string | null | undefined; workspaceId: number | string | null | undefined; text: string }) {
    identify(email, workspaceId != null ? { workspace_id: String(workspaceId), source: 'foreman' } : { source: 'foreman' })
    crisp()?.push(['do', 'message:send', ['text', text]])
    openCrisp()
}

// At a sign-out or a switch of account. The widget stays loaded in the tab, and without this the next
// account to sign in on this browser would read the conversation of the one that left.
export function resetCrisp() {
    const target = window as CrispWindow
    if (!target.$crisp) return
    target.CRISP_TOKEN_ID = null
    target.$crisp.push(['do', 'session:reset'])
}
