// Le contrat du test A/B de la landing, partagé par les deux apps. Le cookie est posé sur
// `.rerun.build` par le proxy de la landing, donc `app.rerun.build` sait relire le bras d'un
// visiteur sans dépendre de la propagation des super-properties PostHog : leur persistance est
// `localStorage+cookie`, et le localStorage ne traverse pas les sous-domaines.
//
// Rien ici n'importe posthog-js : le proxy edge de la landing lit ce fichier.
export const EXPERIMENT_COOKIE = 'rerun-ab'

export const EXPERIMENT_COOKIE_MAX_AGE = 90 * 24 * 60 * 60

// Une clé porte sa version, et un changement de clé est le seul moyen de re-tirer le bras d'un
// visiteur déjà enrôlé, dont le cookie vit 90 jours. Les titres du hero ont été testés ainsi de
// `hero` à `hero7`, chaque clé re-tirant ceux qu'elle rebrassait. `hero7` s'est arrêté le
// 15 octobre 2026 avec la home v2, qui n'a qu'un titre. Une lettre ne sert qu'à un seul titre,
// tests successifs compris : de E à K, toutes sont brûlées.
//
// Retirer une valeur ou une clé ne demande pas de changer la clé restante : `parseExperimentCookie`
// valide chaque paire contre cette liste, donc la paire `hero7` ou `hero_visual` des visiteurs
// enrôlés quand ces tests tournaient encore est simplement ignorée.
//
// `price1` a tranché le 27 novembre 2026 : tout le monde est à 29 $. Aucun test ne tourne, la liste
// reste pour le prochain. Un cookie `price1:…` encore posé est ignoré par `parseExperimentCookie`.
export const EXPERIMENT_VALUES = {} as const satisfies Record<string, readonly string[]>

export type ExperimentKey = keyof typeof EXPERIMENT_VALUES

export type ExperimentValue<K extends ExperimentKey> = (typeof EXPERIMENT_VALUES)[K][number]

export type ExperimentVariants = { [K in ExperimentKey]?: ExperimentValue<K> }

// Dérivé plutôt que déclaré : la liste ne peut pas diverger de celle des valeurs. L'ordre est celui
// de la déclaration ci-dessus, et c'est lui qui fixe l'ordre des paires dans le cookie.
export const EXPERIMENT_KEYS: readonly ExperimentKey[] = Object.keys(EXPERIMENT_VALUES).filter((key): key is ExperimentKey => key in EXPERIMENT_VALUES)

// Une clé absente se tire à parts égales. Un poids de 0 retire un bras du tirage sans le retirer des
// valeurs : le cookie qui le porte reste valide, mais un visiteur qui le porte encore est re-tiré.
export const EXPERIMENT_WEIGHTS: { [K in ExperimentKey]?: Record<ExperimentValue<K>, number> } = {}

function pick<T>(values: readonly T[]): T {
    return values[Math.floor(Math.random() * values.length)]
}

function pickWeighted<T extends string>(weights: Record<T, number>): T {
    const entries = (Object.entries(weights) as [T, number][]).filter(([, weight]) => weight > 0)
    let remaining = Math.random() * entries.reduce((total, [, weight]) => total + weight, 0)
    for (const [value, weight] of entries) {
        if (remaining < weight) return value
        remaining -= weight
    }
    return entries[entries.length - 1][0]
}

export function drawVariant<K extends ExperimentKey>(key: K): ExperimentValue<K> {
    const weights = EXPERIMENT_WEIGHTS[key]
    return weights ? pickWeighted(weights) : pick(EXPERIMENT_VALUES[key])
}

export function isRetiredVariant<K extends ExperimentKey>(key: K, value: ExperimentValue<K>): boolean {
    return EXPERIMENT_WEIGHTS[key]?.[value] === 0
}

// Un robot ne renvoie pas le cookie : il serait re-tiré à chaque visite, et Google lirait un <h1>
// différent d'un crawl à l'autre. Il n'est donc pas enrôlé et reçoit la variante canonique, celle
// que voit déjà un visiteur qui refuse le cookie.
const CRAWLER_USER_AGENT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|quora link preview|whatsapp|lighthouse|pagespeed|headlesschrome/i

export function isCrawler(userAgent: string | null | undefined): boolean {
    return !userAgent || CRAWLER_USER_AGENT.test(userAgent)
}

// Prend la valeur déjà décodée : le proxy la reçoit ainsi de `request.cookies`, le navigateur la
// décode lui-même avant d'appeler. Chaque valeur est validée contre la liste de SA clé, et une
// clé retirée du test est ignorée.
export function parseExperimentCookie(raw: string | undefined | null): ExperimentVariants {
    const variants: Record<string, string> = {}
    if (!raw) return variants
    for (const pair of raw.split('|')) {
        const [key, value] = pair.split(':')
        const allowed = EXPERIMENT_VALUES[key as ExperimentKey] as readonly string[] | undefined
        if (allowed?.includes(value)) variants[key] = value
    }
    return variants
}

// Le cookie porte tous les tests dans une seule valeur, donc changer une variante impose de
// réécrire la ligne entière.
export function serializeExperimentVariants(variants: ExperimentVariants): string {
    return EXPERIMENT_KEYS.filter(key => variants[key])
        .map(key => `${key}:${variants[key]}`)
        .join('|')
}

// Les buckets partent en super-properties plutôt qu'en events dédiés : chaque `hero_cta_clicked` ou
// `account_created` les porte alors tout seul, ce qui suffit à découper le funnel jusqu'au signup
// sans instrumenter une seule surface de plus.
export function experimentProperties(variants: ExperimentVariants): Record<string, string> {
    const properties: Record<string, string> = {}
    for (const key of EXPERIMENT_KEYS) {
        const value = variants[key]
        if (value) properties[`ab_${key}`] = value
    }
    return properties
}

// Les tests précédents vivaient sous ces noms, dont la valeur reste en localStorage une fois le
// cookie périmé : sans ce retrait, chaque event d'un visiteur revenu porterait encore le bucket d'un
// titre qui n'est plus en ligne, à côté de celui du test en cours.
export const STALE_EXPERIMENT_PROPERTIES = [
    'ab_hero',
    'ab_hero2',
    'ab_hero3',
    'ab_hero4',
    'ab_hero5',
    'ab_hero6',
    'ab_hero7',
    'ab_hero_composer',
    'ab_hero_visual',
    'ab_hero_band',
    'ab_price1',
]

export function readExperimentCookie(): ExperimentVariants {
    if (typeof document === 'undefined') return {}
    const match = document.cookie.match(new RegExp(`(?:^|; )${EXPERIMENT_COOKIE}=([^;]*)`))
    return parseExperimentCookie(match ? decodeURIComponent(match[1]) : undefined)
}

// Mêmes options que le cookie posé par le proxy, sans quoi on poserait un second cookie à côté du
// sien au lieu de l'écraser.
export function writeExperimentVariants(variants: ExperimentVariants) {
    const parts = [
        `${EXPERIMENT_COOKIE}=${encodeURIComponent(serializeExperimentVariants(variants))}`,
        'path=/',
        `max-age=${EXPERIMENT_COOKIE_MAX_AGE}`,
        'SameSite=Lax',
    ]
    if (location.hostname.endsWith('rerun.build')) parts.push('domain=.rerun.build')
    if (location.protocol === 'https:') parts.push('Secure')
    document.cookie = parts.join('; ')
}

export function clearExperimentCookie() {
    const parts = [`${EXPERIMENT_COOKIE}=`, 'path=/', 'max-age=0']
    if (location.hostname.endsWith('rerun.build')) parts.push('domain=.rerun.build')
    document.cookie = parts.join('; ')
}
