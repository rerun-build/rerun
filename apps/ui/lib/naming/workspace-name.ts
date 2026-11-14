export const DEFAULT_WORKSPACE_NAME = 'My workspace'

export const WORKSPACE_NAME_MAX = 60

export function asTitle(firstName: string): string {
    const name = firstName.trim()
    return name ? name[0].toLocaleUpperCase() + name.slice(1) : name
}

export function possessive(firstName: string): string {
    const name = firstName.trim()
    return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

function cap(name: string): string {
    return name.length > WORKSPACE_NAME_MAX ? name.slice(0, WORKSPACE_NAME_MAX).trimEnd() : name
}

export function workspaceNameFrom(input: { companyName?: string | null; firstName?: string | null }): string {
    const company = input.companyName?.trim()
    if (company) return cap(company)

    const first = asTitle(input.firstName ?? '')
    if (first) return cap(`${possessive(first)} workspace`)

    return DEFAULT_WORKSPACE_NAME
}
