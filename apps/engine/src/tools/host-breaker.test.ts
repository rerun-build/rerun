import { describe, expect, it, vi } from 'vitest'
import { BLOCKED_SOURCE_PREFIX, HOST_FAILURE_THRESHOLD, HostBreaker, hostOf, hostsOf, httpFailureInOutput, isFailureStatus, networkFailureInCommand, withHostBreaker } from './host-breaker.js'

describe('HostBreaker', () => {
    it('closes a host after the threshold of consecutive failures and keeps it closed', () => {
        const breaker = new HostBreaker()
        for (let i = 1; i < HOST_FAILURE_THRESHOLD; i++) {
            breaker.record('reddit.com', false)
            expect(breaker.check('reddit.com')).toEqual({ open: true })
        }
        breaker.record('reddit.com', false)
        expect(breaker.check('reddit.com')).toEqual({ open: false, attempts: HOST_FAILURE_THRESHOLD })
        breaker.record('reddit.com', false)
        expect(breaker.check('reddit.com').open).toBe(false)
    })

    it('resets the streak on a success', () => {
        const breaker = new HostBreaker()
        breaker.record('reddit.com', false)
        breaker.record('reddit.com', false)
        expect(breaker.record('reddit.com', true)).toBe(0)
        breaker.record('reddit.com', false)
        expect(breaker.check('reddit.com')).toEqual({ open: true })
    })

    it('names the host in the blocked message', () => {
        expect(new HostBreaker().blockedMessage('reddit.com')).toMatch(new RegExp(`^${BLOCKED_SOURCE_PREFIX} reddit.com refused ${HOST_FAILURE_THRESHOLD}`))
    })
})

describe('hostOf', () => {
    it('lowercases and strips www', () => {
        expect(hostOf('https://WWW.Reddit.com/r/startups.json')).toBe('reddit.com')
        expect(hostOf('http://archive.org/a')).toBe('archive.org')
    })

    it('returns null on garbage', () => {
        expect(hostOf('not a url')).toBeNull()
    })
})

describe('hostsOf', () => {
    it('collects each host once from a shell command', () => {
        expect(hostsOf('curl -s https://www.reddit.com/r/x.json | jq . && wget http://archive.org/a; curl https://reddit.com/y')).toEqual(['reddit.com', 'archive.org'])
    })

    it('finds nothing in a command without URLs', () => {
        expect(hostsOf('ls -la && npm test')).toEqual([])
    })
})

describe('isFailureStatus', () => {
    it.each([
        [200, false],
        [301, false],
        [404, false],
        [401, true],
        [403, true],
        [407, true],
        [429, true],
        [500, true],
        [502, true],
    ])('%s → %s', (status, failed) => {
        expect(isFailureStatus(status)).toBe(failed)
    })
})

describe('httpFailureInOutput', () => {
    it('spots a refused status in curl or wget output', () => {
        expect(httpFailureInOutput('HTTP/2 403 \ncontent-type: text/html')).toBe(true)
        expect(httpFailureInOutput('HTTP/1.1 429 Too Many Requests')).toBe(true)
        expect(httpFailureInOutput('2026-09-29 ERROR 403: Forbidden.')).toBe(true)
    })

    it('ignores a successful response', () => {
        expect(httpFailureInOutput('HTTP/1.1 200 OK\n{"ok":true}')).toBe(false)
        expect(httpFailureInOutput('')).toBe(false)
    })
})

describe('networkFailureInCommand', () => {
    const script = 'python3 crawl.py https://example.com'

    it.each([
        ['requests, connection dropped', script, 1, "ConnectionError: ('Connection aborted.', RemoteDisconnected('Remote end closed connection without response'))"],
        ['requests, refused status', script, 1, 'requests.exceptions.HTTPError: 403 Client Error: Forbidden for url: https://example.com'],
        ['urllib, refused status', script, 1, 'urllib.error.HTTPError: HTTP Error 503: Service Unavailable'],
        ['urllib, no connection', script, 1, 'urllib.error.URLError: <urlopen error [Errno 111] Connection refused>'],
        ['httpx, refused status', script, 1, "httpx.HTTPStatusError: Client error '429 Too Many Requests' for url 'https://example.com'"],
        ['node', 'node crawl.js https://example.com', 1, 'TypeError: fetch failed\n  [cause]: Error: read ECONNRESET'],
        ['python, no answer', script, 1, 'TimeoutError: timed out'],
        ['git', 'git clone https://example.com/x.git', 128, 'fatal: unable to access: Failed to connect to example.com port 443'],
        ['browser', 'node shot.js https://example.com', 1, 'page.goto: net::ERR_CONNECTION_RESET at https://example.com'],
        ['curl, told', 'curl -sS https://example.com', 6, 'curl: (6) Could not resolve host: example.com'],
        ['curl, refused status told', 'curl -sSf https://example.com', 22, 'curl: (22) The requested URL returned error: 403'],
        ['curl, silent', 'curl -s https://example.com', 35, ''],
        ['wget, silent', 'wget -q https://example.com', 4, ''],
        ['curl, refused status told over HTTP/2', 'curl -sSf https://example.com', 56, 'curl: (56) The requested URL returned error: 403'],
        ['curl, HTTP/2 stream cut', 'curl -sS https://example.com', 92, 'curl: (92) HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR (err 2)'],
        ['curl, HTTP/2 stream cut, silent', 'curl -s https://example.com', 92, ''],
        ['curl, stopped by timeout', 'timeout 20 curl -s https://example.com', 124, ''],
        ['wget, refused status told', 'wget https://example.com', 8, '2026-11-23 11:40:16 ERROR 403: Forbidden.'],
        ['axios, refused status', 'node crawl.js https://example.com', 1, 'AxiosError: Request failed with status code 403'],
        ['aiohttp, refused status', script, 1, "aiohttp.client_exceptions.ClientResponseError: 403, message='Forbidden', url='https://example.com'"],
        ['aiohttp, no connection', script, 1, "aiohttp.client_exceptions.ClientConnectorError: Cannot connect to host example.com:443 ssl:default [Connect call failed ('1.2.3.4', 443)]"],
        ['requests, body cut', script, 1, "requests.exceptions.ChunkedEncodingError: ('Connection broken: IncompleteRead(0 bytes read)', IncompleteRead(0 bytes read))"],
        ['node, no answer', 'node crawl.js https://example.com', 1, 'node:internal/modules/run_main:107\n    triggerUncaughtException(\n    ^\n\n[DOMException [TimeoutError]: The operation was aborted due to timeout]'],
        ['node, no answer, thrown', 'node crawl.js https://example.com', 1, 'DOMException [TimeoutError]: The operation was aborted due to timeout\n    at new DOMException'],
    ])('%s is a failure of the host', (_, command, exitCode, output) => {
        expect(networkFailureInCommand({ command, exitCode, output })).toBe(true)
    })

    it.each([
        ['a missing program', 'nope https://example.com', 127, '/bin/sh: 1: nope: not found'],
        ['a missing module', script, 1, "ModuleNotFoundError: No module named 'bs4'"],
        ['a missing page', script, 1, 'requests.exceptions.HTTPError: 404 Client Error: Not Found for url: https://example.com'],
        ['a grep without a match', 'curl -s https://example.com | grep nothing', 1, ''],
        ['an exit code that only means network for curl', 'node crawl.js https://example.com', 7, ''],
        ['a curl that cannot write its file', 'curl -o /nope/x https://example.com', 23, 'curl: (23) Failure writing output to destination'],
        ['a missing page told by curl', 'curl -sSf https://example.com/sitemap.xml', 22, 'curl: (22) The requested URL returned error: 404'],
        ['a missing page told by curl over HTTP/2', 'curl -sSf https://example.com/sitemap.xml', 56, 'curl: (56) The requested URL returned error: 404'],
        ['a status curl does not tell', 'curl -sf https://example.com/sitemap.xml', 22, ''],
        ['a missing page told by wget', 'wget https://example.com/sitemap.xml', 8, '2026-11-23 11:40:16 ERROR 404: Not Found.'],
        ['a status wget does not tell', 'wget -q https://example.com/sitemap.xml', 8, ''],
        ['a missing page told by axios', 'node crawl.js https://example.com', 1, 'AxiosError: Request failed with status code 404'],
        ['a missing page told by aiohttp', script, 1, "aiohttp.client_exceptions.ClientResponseError: 404, message='Not Found', url='https://example.com'"],
        ['a traceback that quotes a network handler', script, 1, "  File \"crawl.py\", line 9, in <module>\n    except (ConnectionError, TimeoutError) as e: log(e.respons)\nAttributeError: 'ConnectionError' object has no attribute 'respons'"],
        ['a killed process', script, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', ''],
    ])('%s is not', (_, command, exitCode, output) => {
        expect(networkFailureInCommand({ command, exitCode, output })).toBe(false)
    })
})

describe('withHostBreaker', () => {
    it('neither counts nor clears the streak on an attempt that says nothing about the host', async () => {
        const breaker = new HostBreaker()
        breaker.record('reddit.com', false)
        breaker.record('reddit.com', false)
        expect(await withHostBreaker(breaker, ['reddit.com'], async () => ({ text: 'not found', failed: null }))).toBe('not found')
        expect(breaker.check('reddit.com')).toEqual({ open: true })
        expect(breaker.record('reddit.com', false)).toBe(HOST_FAILURE_THRESHOLD)
    })

    it('runs without bookkeeping when no host is involved', async () => {
        const breaker = new HostBreaker()
        const attempt = vi.fn(async () => ({ text: 'out', failed: true }))
        expect(await withHostBreaker(breaker, [], attempt)).toBe('out')
        expect(breaker.check('reddit.com')).toEqual({ open: true })
    })

    it('appends the attempt count, then the blocked message, then stops calling the tool', async () => {
        const breaker = new HostBreaker()
        const attempt = vi.fn(async () => ({ text: '[403] https://reddit.com/x', failed: true }))
        expect(await withHostBreaker(breaker, ['reddit.com'], attempt)).toBe(`[403] https://reddit.com/x\n\n[attempt 1/${HOST_FAILURE_THRESHOLD} on reddit.com failed in this run]`)
        await withHostBreaker(breaker, ['reddit.com'], attempt)
        const third = await withHostBreaker(breaker, ['reddit.com'], attempt)
        expect(third).toContain('[403] https://reddit.com/x')
        expect(third).toContain(BLOCKED_SOURCE_PREFIX)
        const fourth = await withHostBreaker(breaker, ['reddit.com'], attempt)
        expect(fourth.startsWith(BLOCKED_SOURCE_PREFIX)).toBe(true)
        expect(attempt).toHaveBeenCalledTimes(HOST_FAILURE_THRESHOLD)
    })

    it('leaves a successful result untouched', async () => {
        const breaker = new HostBreaker()
        breaker.record('reddit.com', false)
        expect(await withHostBreaker(breaker, ['reddit.com'], async () => ({ text: 'fine', failed: false }))).toBe('fine')
        expect(breaker.check('reddit.com')).toEqual({ open: true })
    })
})
