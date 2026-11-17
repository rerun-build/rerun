export const SKILL_DESCRIPTION_MAX_CHARS = 120
export const SKILL_BODY_MAX_WORDS = 150

export const SKILL_STYLE = `Write it terse, for a reader who already knows the job. The description is one line under ${SKILL_DESCRIPTION_MAX_CHARS} characters saying when to use the skill. The body stays under ${SKILL_BODY_MAX_WORDS} words, in at most three sections, each left out when it would be empty: "## Steps", a numbered list with one imperative action per line; "## Rules", one constraint per line; "## Done when", one line. No preamble, no summary, no why unless a rule breaks without it, nothing a tool's own description already says, at most one short example.`
