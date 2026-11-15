const RESERVED_DOMAINS = ['example.com', 'example.org', 'example.net', 'localhost', 'invalid', 'test']
const RESERVED_SUFFIXES = ['.test', '.example', '.invalid', '.localhost', '.local']

export type UndeliverableReason = 'invalid syntax' | 'reserved domain'

export function undeliverableReason(email: string): UndeliverableReason | null {
    const address = email.trim().toLowerCase()
    const at = address.indexOf('@')

    if (at <= 0 || at !== address.lastIndexOf('@') || at === address.length - 1) return 'invalid syntax'
    if (/[\s,;<>]/.test(address)) return 'invalid syntax'

    const domain = address.slice(at + 1)
    if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return 'invalid syntax'

    if (RESERVED_SUFFIXES.some(suffix => domain.endsWith(suffix))) return 'reserved domain'
    if (RESERVED_DOMAINS.some(reserved => domain === reserved || domain.endsWith(`.${reserved}`))) return 'reserved domain'

    return null
}
