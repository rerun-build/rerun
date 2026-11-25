'use client'

import dynamic from 'next/dynamic'

// What the panels draw is a large part of the app: the form never waits for them, and a screen too
// narrow for the panel never loads them.
export const LazyShowcase = dynamic(() => import('../showcase/Showcase').then(module => module.Showcase), { ssr: false })
export const LazyTeamPanel = dynamic(() => import('./TeamPanel').then(module => module.TeamPanel), { ssr: false })
