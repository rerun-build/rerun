// A string names the product with `{brand}`, which the pack fills in when it loads: an organization
// shows the app under its own name. These say "Rerun" itself: the surfaces only Rerun has (its site,
// its iOS and desktop apps) and the keys about the company behind the product.
const RERUN_NAMESPACES = /^(landing|mobile)[A-Z]|^desktop(App|Shell)$/

const RERUN_KEYS = [
    /^account\.tabs\.desktop\./,
    /^auth\.creator(Join|Onboarding)\./,
    /^billing\.lifetime\.title$/,
    /^billing\.checkout\.pay\.authorize$/,
    /^billing\.checkout\.card\.payLaterFootnote$/,
    /^billing\.parts\.terms$/,
    /^dialogs\.createTemplate\.defaultDescription$/,
    /^emails\.(subjects\.)?(creatorPitch|lifetimeCode)\b/,
    /^emails\.creatorInvite\./,
    /^errors\.(machineBelongsToCloud|serversManagedByCloud|templateAuthoringExpertOnly)$/,
    /^kit\.experts\./,
    /^templates\.(expert|payouts|pricing|revenue)\./,
    /^templates\.library\.empty\./,
]

export function maySayRerun(id) {
    return RERUN_NAMESPACES.test(id.split('.')[0]) || RERUN_KEYS.some(pattern => pattern.test(id))
}

export function rerunProblem(id, text) {
    return /\bRerun\b/.test(text) && !maySayRerun(id) ? `${id}: names Rerun, write {brand} (scripts/i18n/brand.mjs lists what may)` : null
}
