import { CollectorSkipped, type Collector } from './types'
import { companyNameGuess } from './company-name'
import { mentionsName } from './social'

export type RegistryCompany = {
    siren: string
    name: string
    naf: string | null
    category: string | null
    createdAt: string | null
    headcount: string | null
    active: boolean
    address: string | null
    city: string | null
    officers: { name: string; role: string | null }[]
    finances: { year: string; revenue: number | null; netIncome: number | null } | null
}

export type RegistryFindings = {
    matchedBy: 'siren' | 'name'
    query: string
    personIsOfficer: boolean
    company: RegistryCompany | null
    candidates: { siren: string; name: string; city: string | null }[]
}

const HEADCOUNT_BRACKETS: Record<string, string> = {
    NN: 'non déclaré',
    '00': '0 salarié',
    '01': '1 à 2',
    '02': '3 à 5',
    '03': '6 à 9',
    '11': '10 à 19',
    '12': '20 à 49',
    '21': '50 à 99',
    '22': '100 à 199',
    '31': '200 à 249',
    '32': '250 à 499',
    '41': '500 à 999',
    '42': '1 000 à 1 999',
    '51': '2 000 à 4 999',
    '52': '5 000 à 9 999',
    '53': '10 000 et plus',
}

export function findSiren(text: string): string | null {
    const match = text.match(/\b(?:SIREN|SIRET|RCS)\b[^0-9]{0,60}(\d{3}[\s.]?\d{3}[\s.]?\d{3})/i)
    return match ? match[1].replace(/\D/g, '') : null
}

type ApiResult = {
    siren: string
    nom_complet: string
    activite_principale?: string | null
    categorie_entreprise?: string | null
    date_creation?: string | null
    tranche_effectif_salarie?: string | null
    etat_administratif?: string | null
    siege?: { adresse?: string | null; libelle_commune?: string | null } | null
    dirigeants?: { nom?: string; prenoms?: string; denomination?: string; qualite?: string | null }[]
    finances?: Record<string, { ca?: number | null; resultat_net?: number | null }> | null
}

export function readRegistryResult(result: ApiResult): RegistryCompany {
    const years = Object.keys(result.finances ?? {}).sort()
    const lastYear = years.at(-1)
    return {
        siren: result.siren,
        name: result.nom_complet,
        naf: result.activite_principale ?? null,
        category: result.categorie_entreprise ?? null,
        createdAt: result.date_creation ?? null,
        headcount: result.tranche_effectif_salarie ? (HEADCOUNT_BRACKETS[result.tranche_effectif_salarie] ?? result.tranche_effectif_salarie) : null,
        active: result.etat_administratif === 'A',
        address: result.siege?.adresse ?? null,
        city: result.siege?.libelle_commune ?? null,
        officers: (result.dirigeants ?? []).map(officer => ({
            name: officer.denomination ?? [officer.prenoms, officer.nom].filter(Boolean).join(' '),
            role: officer.qualite ?? null,
        })),
        finances: lastYear ? { year: lastYear, revenue: result.finances![lastYear].ca ?? null, netIncome: result.finances![lastYear].resultat_net ?? null } : null,
    }
}

export const registryCollector: Collector<'registry'> = {
    id: 'registry',
    needs: ['site', 'stack'],
    async run({ input, need }) {
        const [site, stack] = await Promise.all([need('site'), need('stack')])
        const legalFirst = [...(site?.pages ?? [])].sort((a, b) => Number(b.category === 'legal') - Number(a.category === 'legal'))
        const siren = legalFirst.map(page => findSiren(page.markdown)).find(Boolean) ?? null
        const query = siren ?? companyNameGuess(input, stack, site)

        const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}&per_page=5`, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error(`recherche-entreprises answered ${res.status}`)
        const results = ((await res.json()) as { results?: ApiResult[] }).results ?? []
        if (!results.length) throw new CollectorSkipped(`Aucune entreprise pour « ${query} »`)

        const company = readRegistryResult(results[0])
        const personName = input.personName
        const personIsOfficer = personName ? company.officers.some(officer => mentionsName(officer.name, personName)) : false
        const data: RegistryFindings = {
            matchedBy: siren ? 'siren' : 'name',
            query,
            personIsOfficer,
            company,
            candidates: results.slice(1).map(result => ({ siren: result.siren, name: result.nom_complet, city: result.siege?.libelle_commune ?? null })),
        }
        return {
            data,
            highlights: [
                `${company.name} (SIREN ${company.siren}), trouvé par ${siren ? 'SIREN sur le site' : personIsOfficer ? 'nom, la personne est dirigeante' : 'nom seul, sans doute un homonyme'}`,
                `NAF ${company.naf ?? '?'} · ${company.category ?? '?'} · effectif ${company.headcount ?? '?'} · créée ${company.createdAt ?? '?'}`,
                company.officers.length ? `Dirigeants : ${company.officers.slice(0, 3).map(officer => `${officer.name} (${officer.role ?? '?'})`).join(', ')}` : 'Aucun dirigeant publié',
                company.finances ? `CA ${company.finances.year} : ${company.finances.revenue?.toLocaleString('fr-FR') ?? '?'} €` : 'Pas de comptes publiés',
            ],
        }
    },
}
