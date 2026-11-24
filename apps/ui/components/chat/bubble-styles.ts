// The thread speaks in two shapes. Everything an agent shows sits on the first; everything the
// user sent takes the second, whose classes only bite inside a `Message from="user"`.
export const AGENT_BUBBLE_SURFACE = 'rounded-[20px] bg-muted'

export const USER_BUBBLE_SHAPE = 'group-[.is-user]:rounded-2xl group-[.is-user]:rounded-ee-md group-[.is-user]:px-3.5 group-[.is-user]:py-2'

// The brand's bubble against the agent's grey bubbles, so who said what reads at a glance. Links and
// inline code take the bubble's ink, their own colours would vanish on it; the voice player too,
// through `data-ink`, where composer tokens switch to a pale shade of their own hue. Forced, because
// Streamdown styles both outside any cascade layer.
export const USER_BUBBLE_INK = 'group-[.is-user]:bg-bubble group-[.is-user]:text-bubble-ink [&_[data-streamdown=link]]:text-bubble-ink! [&_[data-streamdown=inline-code]]:bg-bubble-ink/15! [&_[data-streamdown=inline-code]]:text-bubble-ink!'
