import { describe, expect, it, vi } from 'vitest'
import { UploadAbortedError, UploadHttpError, UploadNetworkError, xhrUpload } from './upload-client'

type Listener = (event: { loaded: number; total: number; lengthComputable: boolean }) => void

class FakeXhr {
    static last: FakeXhr
    status = 0
    responseText = ''
    upload = { listeners: new Map<string, Listener[]>(), addEventListener: (t: string, fn: Listener) => this.on(this.upload.listeners, t, fn) }
    listeners = new Map<string, Listener[]>()
    sent: unknown = null

    constructor() {
        FakeXhr.last = this
    }

    private on(map: Map<string, Listener[]>, type: string, fn: Listener) {
        map.set(type, [...(map.get(type) ?? []), fn])
    }

    addEventListener(type: string, fn: Listener) {
        this.on(this.listeners, type, fn)
    }

    open() {}
    setRequestHeader() {}
    send(body: unknown) {
        this.sent = body
    }
    abort() {
        this.emit(this.listeners, 'abort')
    }

    emit(map: Map<string, Listener[]>, type: string, event = { loaded: 0, total: 0, lengthComputable: true }) {
        for (const fn of map.get(type) ?? []) fn(event)
    }

    progress(loaded: number, total: number) {
        this.emit(this.upload.listeners, 'progress', { loaded, total, lengthComputable: true })
    }

    finish(status: number, responseText = '') {
        this.status = status
        this.responseText = responseText
        this.emit(this.upload.listeners, 'loadend')
        this.emit(this.listeners, 'load')
    }
}

function upload(overrides: { onProgress?: (l: number, t: number) => void; onSent?: () => void } = {}) {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const handle = xhrUpload({
        url: '/api/files/stream?name=a.bin',
        body: new Blob(['hello']),
        onProgress: overrides.onProgress ?? (() => {}),
        onSent: overrides.onSent ?? (() => {}),
    })
    return { handle, xhr: FakeXhr.last }
}

describe('xhrUpload', () => {
    it('reports how many bytes have been sent', async () => {
        const seen: number[] = []
        const { handle, xhr } = upload({ onProgress: loaded => seen.push(loaded) })

        xhr.progress(30, 100)
        xhr.progress(100, 100)
        xhr.finish(201, '{"path":"a.bin","bytes":100}')

        await expect(handle.promise).resolves.toEqual({ path: 'a.bin', bytes: 100 })
        expect(seen).toEqual([30, 100])
    })

    it('signals the handover before the response arrives', async () => {
        const onSent = vi.fn()
        const { handle, xhr } = upload({ onSent })

        xhr.progress(100, 100)
        expect(onSent).not.toHaveBeenCalled()

        xhr.finish(201, '{}')
        await handle.promise
        expect(onSent).toHaveBeenCalledOnce()
    })

    it('surfaces the message the route sent back', async () => {
        const { handle, xhr } = upload()
        xhr.finish(413, '{"error":"video.mp4 is over the 100 MB limit."}')

        await expect(handle.promise).rejects.toThrow('video.mp4 is over the 100 MB limit.')
        await expect(handle.promise).rejects.toBeInstanceOf(UploadHttpError)
    })

    it('falls back to a readable message when the body is empty', async () => {
        const { handle, xhr } = upload()
        xhr.finish(401, '')

        await expect(handle.promise).rejects.toThrow('Your session expired. Reload the page and try again.')
    })

    it('separates a dropped connection from a refusal', async () => {
        const { handle, xhr } = upload()
        xhr.emit(xhr.listeners, 'error')

        await expect(handle.promise).rejects.toBeInstanceOf(UploadNetworkError)
    })

    it('reports a cancel as its own kind of failure', async () => {
        const { handle } = upload()
        handle.abort()

        await expect(handle.promise).rejects.toBeInstanceOf(UploadAbortedError)
    })
})
