'use client'

import { useEffect } from 'react'

function settled(image: HTMLImageElement): Promise<void> {
    if (image.complete) return Promise.resolve()
    return new Promise(resolve => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
    })
}

const neverLoads = (image: HTMLImageElement) => image.loading === 'lazy' && image.getClientRects().length === 0

async function imagesSettled() {
    for (let round = 0; round < 5; round++) {
        const images = Array.from(document.images).filter(image => !neverLoads(image))
        if (images.every(image => image.complete)) return
        await Promise.all(images.map(settled))
    }
}

function freezeSvgAnimations() {
    for (const svg of document.querySelectorAll('svg')) {
        if (!(svg instanceof SVGSVGElement)) continue
        svg.setCurrentTime(0)
        svg.pauseAnimations()
    }
}

function pauseCssAnimations() {
    const style = document.createElement('style')
    style.textContent = '*, *::before, *::after { animation-play-state: paused !important }'
    document.head.appendChild(style)
}

const isEndless = (animation: Animation) => animation.effect?.getComputedTiming().iterations === Infinity

async function animationsSettled() {
    await Promise.all(
        document
            .getAnimations()
            .filter(animation => !isEndless(animation))
            .map(animation => animation.finished.catch(() => {})),
    )

    pauseCssAnimations()

    for (let round = 0; round < 3; round++) {
        await nextFrame()
        for (const animation of document.getAnimations()) {
            if (isEndless(animation)) animation.currentTime = 0
        }
    }
}

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

export function OgReadyMarker() {
    useEffect(() => {
        let cancelled = false

        void (async () => {
            await document.fonts.ready
            await imagesSettled()
            freezeSvgAnimations()
            await animationsSettled()
            await nextFrame()
            if (!cancelled) document.documentElement.dataset.ogReady = 'true'
        })()

        return () => {
            cancelled = true
            delete document.documentElement.dataset.ogReady
        }
    }, [])

    return null
}
