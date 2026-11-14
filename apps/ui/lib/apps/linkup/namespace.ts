export function linkupNamespace(): string {
    return process.env.LINKUP_NAMESPACE || 'local'
}

export function inNamespace(accountName: string | null | undefined, namespace = linkupNamespace()): boolean {
    return !!accountName && accountName.startsWith(`${namespace}:`)
}
