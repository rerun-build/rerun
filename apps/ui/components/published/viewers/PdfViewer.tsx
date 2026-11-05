'use client'

import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Skeleton } from '@/components/ui/skeleton'
import { FileTextIcon, PresentationIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { DownloadCard } from './DownloadCard'
import { slideFit } from './slide-fit'
import { SlideStage } from './SlideStage'
import { RAW_URL, ViewerPage, ViewerTopBar } from './ViewerChrome'

// Rendered page by page with pdf.js rather than handed to the browser's viewer: Safari on iOS shows
// only the first page of a PDF in a frame.
type LoadedPdf = { doc: PDFDocumentProxy; aspect: number; landscape: boolean }
type PdfLoad = { promise: Promise<LoadedPdf>; destroy: () => Promise<void> }

const PAGE_PRERENDER_MARGIN = '150% 0px'

function openPdf(): PdfLoad {
    let destroyTask: () => Promise<void> = async () => {}
    const promise = (async () => {
        const pdfjs = await import('pdfjs-dist')
        // The bundler only ships a worker it sees built this way; a bare `workerSrc` URL hands
        // pdf.js a module chunk it cannot start.
        const worker = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
        const task = pdfjs.getDocument({ url: RAW_URL, worker: pdfjs.PDFWorker.create({ port: worker }) })
        destroyTask = async () => {
            await task.destroy()
            worker.terminate()
        }
        const doc = await task.promise
        const first = (await doc.getPage(1)).getViewport({ scale: 1 })
        return { doc, aspect: first.width / first.height, landscape: first.width > first.height }
    })()
    return { promise, destroy: () => destroyTask() }
}

function PdfCanvas({ doc, pageNumber, aspect, eager = false, fit = false, className }: { doc: PDFDocumentProxy; pageNumber: number; aspect: number; eager?: boolean; fit?: boolean; className?: string }) {
    const frame = useRef<HTMLDivElement>(null)
    const canvas = useRef<HTMLCanvasElement>(null)
    const [visible, setVisible] = useState(eager)
    const [pageAspect, setPageAspect] = useState(aspect)
    const [rendered, setRendered] = useState(false)

    useEffect(() => {
        if (visible || !frame.current) return
        const observer = new IntersectionObserver(entries => entries.some(entry => entry.isIntersecting) && setVisible(true), { rootMargin: PAGE_PRERENDER_MARGIN })
        observer.observe(frame.current)
        return () => observer.disconnect()
    }, [visible])

    useEffect(() => {
        if (!visible || !canvas.current || !frame.current) return
        let cancelled = false
        let task: { cancel: () => void } | null = null
        void (async () => {
            const page = await doc.getPage(pageNumber)
            if (cancelled || !canvas.current || !frame.current) return
            const base = page.getViewport({ scale: 1 })
            setPageAspect(base.width / base.height)
            const pixels = frame.current.clientWidth * window.devicePixelRatio
            const viewport = page.getViewport({ scale: pixels / base.width })
            canvas.current.width = Math.floor(viewport.width)
            canvas.current.height = Math.floor(viewport.height)
            const render = page.render({ canvas: canvas.current, viewport })
            task = render
            await render.promise.catch(() => {})
            if (!cancelled) setRendered(true)
        })()
        return () => {
            cancelled = true
            task?.cancel()
        }
    }, [doc, pageNumber, visible])

    return (
        <div ref={frame} data-page={pageNumber} className={cn('relative overflow-hidden bg-white', !fit && 'w-full', className)} style={{ aspectRatio: pageAspect, ...(fit ? slideFit(pageAspect) : {}) }}>
            {!rendered && <Skeleton className="absolute inset-0 rounded-none bg-black/5" />}
            <canvas ref={canvas} className="block size-full" aria-label={`Page ${pageNumber}`} />
        </div>
    )
}

function PdfPages({ pdf, onPage }: { pdf: LoadedPdf; onPage: (page: number) => void }) {
    const list = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!list.current) return
        const ratios = new Map<number, number>()
        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) ratios.set(Number((entry.target as HTMLElement).dataset.page), entry.intersectionRatio)
                const [best] = [...ratios.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
                if (best && best[1] > 0) onPage(best[0])
            },
            { threshold: [0, 0.25, 0.5, 0.75, 1] },
        )
        list.current.querySelectorAll('[data-page]').forEach(page => observer.observe(page))
        return () => observer.disconnect()
    }, [pdf, onPage])

    return (
        <div ref={list} className="flex flex-col items-center gap-4 bg-muted/60 px-4 py-6 pb-20">
            {Array.from({ length: pdf.doc.numPages }, (_, i) => (
                <div key={i} className="w-full max-w-[560px]">
                    <PdfCanvas doc={pdf.doc} pageNumber={i + 1} aspect={pdf.aspect} eager={i === 0} className="rounded-sm shadow-md ring-1 ring-black/5" />
                </div>
            ))}
        </div>
    )
}

function PdfSkeleton() {
    return (
        <div className="flex flex-col items-center gap-4 bg-muted/60 px-4 py-6">
            <Skeleton className="aspect-[1/1.414] w-full max-w-[560px] rounded-sm" />
        </div>
    )
}

export function PdfViewer({ slug, name, size }: { slug: string; name: string; size: number }) {
    const [pdf, setPdf] = useState<LoadedPdf | null>(null)
    const [failed, setFailed] = useState(false)
    const [page, setPage] = useState(1)

    useEffect(() => {
        let cancelled = false
        const load = openPdf()
        load.promise.then(loaded => !cancelled && setPdf(loaded)).catch(() => !cancelled && setFailed(true))
        return () => {
            cancelled = true
            void load.destroy()
        }
    }, [])

    if (failed) return <DownloadCard slug={slug} name={name} size={size} />

    if (pdf?.landscape) {
        return (
            <ViewerPage slug={slug} bar={<ViewerTopBar icon={PresentationIcon} name={name} meta={`${pdf.doc.numPages} slide${pdf.doc.numPages === 1 ? '' : 's'}`} />} className="overflow-hidden">
                <SlideStage
                    slides={Array.from({ length: pdf.doc.numPages }, (_, i) => (
                        <PdfCanvas key={i} doc={pdf.doc} pageNumber={i + 1} aspect={pdf.aspect} eager fit className="rounded-lg shadow-2xl" />
                    ))}
                />
            </ViewerPage>
        )
    }

    const counter = pdf && <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">{page} / {pdf.doc.numPages}</span>
    return (
        <ViewerPage slug={slug} bar={<ViewerTopBar icon={FileTextIcon} name={name}>{counter}</ViewerTopBar>}>
            {pdf ? <PdfPages pdf={pdf} onPage={setPage} /> : <PdfSkeleton />}
        </ViewerPage>
    )
}
