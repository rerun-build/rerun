export const HOST_FAILURE_THRESHOLD = 3
export const BLOCKED_SOURCE_PREFIX = 'Source closed for this run:'

const URL_IN_COMMAND = /https?:\/\/[^\s"'<>|;&)]+/gi
const HTTP_FAILURE_IN_OUTPUT = /\bHTTP\/[0-9.]+\s+(401|403|407|429|5\d\d)\b|\bERROR (401|403|407|429|5\d\d)\b/

export type HostAttempt = { text: string; failed: boolean }

export class HostBreaker {
    private failures = new Map<string, number>()

    record(host: string, ok: boolean): number {
        const count = ok ? 0 : (this.failures.get(host) ?? 0) + 1
        this.failures.set(host, count)
        return count
    }

    check(host: string): { open: true } | { open: false; attempts: number } {
        const attempts = this.failures.get(host) ?? 0
        return attempts >= HOST_FAILURE_THRESHOLD ? { open: false, attempts } : { open: true }
    }

    blockedMessage(host: string): string {
        return `${BLOCKED_SOURCE_PREFIX} ${host} refused ${HOST_FAILURE_THRESHOLD} consecutive attempts (errors, timeouts or a 4xx/5xx status). It will not be retried in this run, with any tool or user coworker. Move on to another source and report what you already have, naming ${host} as unavailable.`
    }
}

export function hostOf(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null
    } catch {
        return null
    }
}

export function hostsOf(command: string): string[] {
    const hosts = new Set<string>()
    for (const match of command.matchAll(URL_IN_COMMAND)) {
        const host = hostOf(match[0])
        if (host) hosts.add(host)
    }
    return [...hosts]
}

export function isFailureStatus(status: number): boolean {
    return status === 401 || status === 403 || status === 407 || status === 429 || status >= 500
}

export function httpFailureInOutput(text: string): boolean {
    return HTTP_FAILURE_IN_OUTPUT.test(text)
}

export async function withHostBreaker(breaker: HostBreaker, hosts: string[], attempt: () => Promise<HostAttempt>): Promise<string> {
    if (hosts.length === 0) return (await attempt()).text
    for (const host of hosts) {
        if (!breaker.check(host).open) return breaker.blockedMessage(host)
    }
    const { text, failed } = await attempt()
    const trailers: string[] = []
    for (const host of hosts) {
        const count = breaker.record(host, !failed)
        if (count === 0) continue
        trailers.push(count >= HOST_FAILURE_THRESHOLD ? breaker.blockedMessage(host) : `[attempt ${count}/${HOST_FAILURE_THRESHOLD} on ${host} failed in this run]`)
    }
    return trailers.length ? `${text}\n\n${trailers.join('\n')}` : text
}
