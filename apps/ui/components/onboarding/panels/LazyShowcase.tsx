'use client'

import dynamic from 'next/dynamic'

// The chat, the composer and the dialogs it draws are a large part of the app: the sign-in form
// never waits for them, and a screen too narrow for the panel never loads them.
export const LazyShowcase = dynamic(() => import('../showcase/Showcase').then(module => module.Showcase), { ssr: false })
