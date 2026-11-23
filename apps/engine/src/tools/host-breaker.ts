export const HOST_FAILURE_THRESHOLD = 3
export const BLOCKED_SOURCE_PREFIX = 'Source closed for this run:'

const URL_IN_COMMAND = /https?:\/\/[^\s"'<>|;&)]+/gi
const HTTP_FAILURE_IN_OUTPUT = /\bHTTP\/[0-9.]+\s+(401|403|407|429|5\d\d)\b|\bERROR (401|403|407|429|5\d\d)\b/

const REFUSED = '(?:401|403|407|429|5\\d\\d)'
const FAILURE_IN_FAILED_COMMAND = new RegExp([`\\bHTTP Error ${REFUSED}\\b`, `\\breturned error: ${REFUSED}\\b`, `\\b${REFUSED} (?:Client|Server) Error\\b`, `\\b(?:Client|Server) error '${REFUSED}\\b`, `\\bstatus code ${REFUSED}\\b`, `\\bClientResponseError: ${REFUSED}\\b`, '\\bconnection (?:was )?(?:reset|refused|aborted|broken|timed out|closed)\\b', '\\b(?:operation|read|connect) timed out\\b', '\\bfailed to connect\\b|\\bcannot connect to host\\b|\\bfetch failed\\b|\\bserver disconnected\\b|<urlopen error\\b', '\\bcould not resolve\\b|\\bname or service not known\\b|\\btemporary failure in name resolution\\b|\\bnodename nor servname\\b', '^\\[?(?:DOMException \\[)?[\\w.]*(?:RemoteDisconnected|ConnectionError|ConnectError|SSLError|TimeoutError|ConnectTimeout|ReadTimeout)\\b', '\\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN)\\b|\\bUND_ERR_\\w+_TIMEOUT\\b|\\bnet::ERR_', '\\bcurl: \\((?:5|6|7|28|35|52|55|56|92)\\)(?! The requested URL returned error)'].join('|'), 'im')
const CURL_ERROR = /\bcurl: \(\d+\)/
// 22 of curl and 8 of wget are left out: they say a 404 as much as a 403.
const NETWORK_EXIT_CODES: [RegExp, Set<number>][] = [
    [/\bcurl\b/, new Set([5, 6, 7, 28, 35, 52, 55, 56, 92])],
    [/\bwget\b/, new Set([4, 5])],
    [/\btimeout\s/, new Set([124])],
]

// null: the attempt failed before reaching the host, so it neither counts against it nor clears it.
export type HostAttempt = { text: string; failed: boolean | null }

/**
 * Counts consecutive failures per host within one run. A host that refused the threshold in a row
 * is closed for the rest of the run: the sub-agent that started this work looped for 34 minutes on
 * a source that answered 403 to every tool, every user agent and every mirror it could think of.
 */
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

// `curl -s` fails without a word, so its exit code is all there is to read. An exception counts only
// where it is raised, at the start of a line: a script that handles ConnectionError names it too.
export function networkFailureInCommand({ command, exitCode, output }: { command: string; exitCode?: number | string; output: string }): boolean {
    if (httpFailureInOutput(output) || FAILURE_IN_FAILED_COMMAND.test(output)) return true
    if (CURL_ERROR.test(output)) return false
    return typeof exitCode === 'number' && NETWORK_EXIT_CODES.some(([tool, codes]) => tool.test(command) && codes.has(exitCode))
}

export async function withHostBreaker(breaker: HostBreaker, hosts: string[], attempt: () => Promise<HostAttempt>): Promise<string> {
    if (hosts.length === 0) return (await attempt()).text
    for (const host of hosts) {
        if (!breaker.check(host).open) return breaker.blockedMessage(host)
    }
    const { text, failed } = await attempt()
    if (failed === null) return text
    const trailers: string[] = []
    for (const host of hosts) {
        const count = breaker.record(host, !failed)
        if (count === 0) continue
        trailers.push(count >= HOST_FAILURE_THRESHOLD ? breaker.blockedMessage(host) : `[attempt ${count}/${HOST_FAILURE_THRESHOLD} on ${host} failed in this run]`)
    }
    return trailers.length ? `${text}\n\n${trailers.join('\n')}` : text
}
