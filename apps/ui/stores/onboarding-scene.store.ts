import { create } from 'zustand'

import { EMPTY_SCENE, type OnboardingScene } from '@/components/onboarding/OnboardingBoard'

// What the onboarding board draws, written by the page in the left column and read by the board in
// the layout around it. The board lives in the layout so it is not remounted between the sign-in and
// the questions: the two pages read as one, and the team keeps working through the navigation.
type OnboardingSceneStore = {
    scene: OnboardingScene
    patch: (next: Partial<OnboardingScene>) => void
}

export const useOnboardingSceneStore = create<OnboardingSceneStore>(set => ({
    scene: EMPTY_SCENE,
    patch: next => set(current => ({ scene: { ...current.scene, ...next } })),
}))
