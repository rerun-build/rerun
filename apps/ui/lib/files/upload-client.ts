export class UploadHttpError extends Error {
    status: number
    serverMessage: string | null
    constructor(status: number, message: string, serverMessage: string | null = null) {
        super(message)
        this.status = status
        this.serverMessage = serverMessage
        this.name = 'UploadHttpError'
    }
}

export class UploadNetworkError extends Error {
    constructor(message = 'Upload failed. Check your connection and retry.') {
        super(message)
        this.name = 'UploadNetworkError'
    }
}

export class UploadAbortedError extends Error {
    constructor() {
        super('Upload canceled')
        this.name = 'UploadAbortedError'
    }
}

export type XhrUploadParams = {
    url: string
    body: Blob
    onProgress: (loaded: number, total: number) => void
    onSent: () => void
}

export type XhrUploadHandle = {
    promise: Promise<unknown>
    abort: () => void
}

function serverMessageOf(responseText: string): string | null {
    try {
        const parsed: unknown = JSON.parse(responseText)
        const message = (parsed as { error?: unknown }).error
        if (typeof message === 'string' && message) return message
    } catch {
    }
    return null
}

function messageFor(status: number, responseText: string): string {
    const message = serverMessageOf(responseText)
    if (message) return message
    if (status === 401 || status === 403) return 'Your session expired. Reload the page and try again.'
    if (status === 413) return 'This file is too large to upload.'
    return 'Upload failed. Retry in a moment.'
}

export function xhrUpload({ url, body, onProgress, onSent }: XhrUploadParams): XhrUploadHandle {
    const xhr = new XMLHttpRequest()

    const promise = new Promise<unknown>((resolve, reject) => {
        xhr.upload.addEventListener('progress', event => {
            if (event.lengthComputable) onProgress(event.loaded, event.total)
        })
        xhr.upload.addEventListener('loadend', () => onSent())
        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    resolve(JSON.parse(xhr.responseText))
                } catch {
                    resolve({})
                }
                return
            }
            reject(new UploadHttpError(xhr.status, messageFor(xhr.status, xhr.responseText), serverMessageOf(xhr.responseText)))
        })
        xhr.addEventListener('error', () => reject(new UploadNetworkError()))
        xhr.addEventListener('timeout', () => reject(new UploadNetworkError('Upload timed out. Retry in a moment.')))
        xhr.addEventListener('abort', () => reject(new UploadAbortedError()))

        xhr.open('POST', url)
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.send(body)
    })

    return { promise, abort: () => xhr.abort() }
}
