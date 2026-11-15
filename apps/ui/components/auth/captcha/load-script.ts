type ScriptOptions<Api> = {
    src: string
    readApi: () => Api | undefined
    failure: () => Error
    readyCallback?: string
}

export function scriptLoader<Api>({ src, readApi, failure, readyCallback }: ScriptOptions<Api>): () => Promise<Api> {
    let loading: Promise<Api> | null = null
    return () => {
        loading ??= new Promise<Api>((resolve, reject) => {
            const script = document.createElement('script')
            const ready = () => {
                const api = readApi()
                if (api) resolve(api)
                else reject(failure())
            }
            script.src = src
            script.async = true
            if (readyCallback) (window as unknown as Record<string, () => void>)[readyCallback] = ready
            else script.onload = ready
            script.onerror = () => {
                loading = null
                script.remove()
                reject(failure())
            }
            document.head.appendChild(script)
        })
        return loading
    }
}
