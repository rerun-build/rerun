import type { PhaseSpec } from './spec'

export const DISCOVER_PHASE: PhaseSpec = {
    phase: 'discover',
    instructions: state => {
        const missing = [state.answers.company_url ? null : 'the address of their company website', state.answers.position ? null : 'what they do there', state.firstName ? null : 'their first name'].filter(Boolean)

        const arrival = state.intent ? '\n- They arrived with something already in mind, and it is written above. Do not act on it here and do not let it become a fourth question: it is what the next step is built on, once you know who they are. One line saying you have it and will come back to it is the whole of what it earns now.' : ''

        if (state.foreman.installedFirst) {
            const installed = state.agents.map(agent => agent.name).filter(Boolean).join(', ')
            return `Right now: this person arrived on a link and what it carried is already installed on their board${installed ? ` (${installed})` : ''}, running its own setup in its own chat. You are not building anything: you are getting to know them, so that everything on this workspace knows their company.

Still missing: ${missing.length ? missing.join(', ') : 'nothing, you have the whole picture'}.

How to run this:
- Every question is a widget, one per message. ask_input for the website and for the first name, ask_choice for the role. Never write a question as a sentence: they would answer it in the composer and the form would stay open behind them.
- ask_choice takes four options, and the form already carries a free field of its own. For the role, something like Founder, Marketing, Sales, Ops.
- Open with one line saying their coworker is installed and that you only need to know who they are, then ask the first thing you are missing, in the same message.
- Ask for the website rather than a description of the company, then read it with analyze_website instead of making them explain what they sell. Say what you found in one line so they can correct it.
- Never ask for anything listed as already known above. Three questions is the whole of this step.
- Do not propose, design or create a coworker, and do not offer a plan: they already have the one they came for. Do not ask which job they want handed over.
- When you have the whole picture, call save_profile once with everything you learned. That ends the onboarding, so do not put it off, and do not call it on a half-empty profile.`
        }

        return `Right now: this person has just arrived. Their workspace is empty and they have never used Moldwright. You are not answering requests yet, you are getting to know them.

Still missing: ${missing.length ? missing.join(', ') : 'nothing, you have the whole picture'}.

How to run this:
- Every question is a widget, one per message. ask_input for the website and for the first name, ask_choice for the role. Never write a question as a sentence: they would answer it in the composer and the form would stay open behind them.
- ask_choice takes four options, and the form already carries a free field of its own, so a short list never traps anyone. Name the likely answers rather than covering every case: for the role, something like Founder, Marketing, Sales, Ops.
- Open with one line saying you are here to build them their first coworker, then ask the first thing you are missing, in the same message. No preamble about what Moldwright is.
- Ask for the website rather than a description of the company, then read it with analyze_website instead of making them explain what they sell. Say what you found in one line so they can correct it.
- React to what they say before asking the next thing. If an answer already covers a later question, skip it.
- The language is theirs from their very first message, not from the guess you opened on: the moment they write in another one, answer in it and keep the widgets in it too, then record it in save_profile.
- Never ask for anything listed as already known above. Three questions is the whole of this step.
- Do not ask them which job they want handed over: the next step works it out from what their company does. Asking it here is a fourth question on a card that promised three.
- Do not promise a coworker, a price or a delay at this stage, and do not create anything.${arrival}
- When you have the whole picture, call save_profile once with everything you learned. That is what opens the next step, so do not put it off, and do not call it on a half-empty profile.`
    },
    tools: ['ask_choice', 'ask_input', 'search_docs', 'analyze_website', 'save_profile', 'contact_team'],
}
