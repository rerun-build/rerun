import { DEFAULT_ADMIN_EMAILS } from '@rerun/cloud/admin'

export function adminEmails(): string[] {
    const configured = process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.ADMIN_EMAILS
    if (!configured) return DEFAULT_ADMIN_EMAILS
    return configured
        .split(',')
        .map(email => email.trim())
        .filter(Boolean)
}

export function isAdminEmail(email: string | null | undefined): boolean {
    if (!email) return false
    const normalized = email.toLowerCase()
    return adminEmails().some(admin => admin.toLowerCase() === normalized)
}
