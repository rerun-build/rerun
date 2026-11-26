// Against a real Chromium on a real X display: skipped unless `RERUN_LIVE=1` and `DISPLAY` are set.
//
//   RERUN_LIVE=1 xvfb-run -a pnpm --filter rerun-engine exec vitest run src/tools/builtin/browser-download.live.test.ts
//
// Chrome for Testing 153 (patchright 1.63) killed its whole browser process on a download started in a
// launch whose profile already held a download in its history: from the second session on, every
// download blacked out the coworker's screen (RER-369).
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-browser-download-live-'))

const { describe, expect, it, vi } = await import('vitest')

// The test page is served from this machine, which the browser's request guard refuses on purpose.
vi.mock('../../lib/public-fetch.js', async importOriginal => ({ ...(await importOriginal<object>()), resolvesToPublicAddresses: async () => true }))

const { launchContext } = await import('./browser.js')

const LIVE = process.env.RERUN_LIVE === '1' && !!process.env.DISPLAY
const LAUNCHES = 3
const SETTLE_MS = 3_000
const invoice = Buffer.alloc(100_000, 'x')

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

describe.skipIf(!LIVE)('a download in the coworker browser', () => {
    it('keeps the browser open on every launch of a profile that has downloaded before', async () => {
        const server = createServer((req, res) => {
            if (req.url === '/invoice.pdf') {
                res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="invoice.pdf"', 'content-length': invoice.length }).end(invoice)
                return
            }
            res.writeHead(200, { 'content-type': 'text/html' }).end('<a id="download" href="/invoice.pdf" download>Download</a>')
        })
        await new Promise<void>(listening => server.listen(0, '127.0.0.1', listening))
        const { port } = server.address() as AddressInfo
        const profileDir = mkdtempSync(resolve(tmpdir(), 'rerun-browser-download-profile-'))
        try {
            for (let launch = 1; launch <= LAUNCHES; launch++) {
                // The options of the window a coworker and a person share (desktop/takeover.ts).
                const context = await launchContext(profileDir, process.env.DISPLAY!, { viewport: null, args: ['--start-maximized'] })
                let browserCrashed = false
                context.once('close', () => (browserCrashed = true))
                try {
                    const page = context.pages()[0] ?? (await context.newPage())
                    await page.goto(`http://127.0.0.1:${port}/`)
                    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')])
                    const saved = await download.path().catch(() => null)
                    await sleep(SETTLE_MS)
                    expect({ launch, browserCrashed, saved: !!saved }).toEqual({ launch, browserCrashed: false, saved: true })
                } finally {
                    if (!browserCrashed) await context.close()
                }
            }
        } finally {
            server.close()
            rmSync(profileDir, { recursive: true, force: true })
        }
    }, 120_000)
})
