// `history.replaceState` plutôt que `router.replace` : Next le synchronise avec `useSearchParams`
// sans repasser par le serveur, donc pas de re-render de la page dynamique (fallback du Suspense
// qui reflashe) ni de navigation qu'une réponse de server action peut recouvrir.
export function clearSearchParams(...keys: string[]) {
    const url = new URL(window.location.href)
    if (!keys.some(key => url.searchParams.has(key))) return
    for (const key of keys) url.searchParams.delete(key)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}
