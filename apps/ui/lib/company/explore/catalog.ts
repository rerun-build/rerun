import { z } from 'zod'

export const COLLECTOR_IDS = ['dns', 'stack', 'site', 'search', 'registry', 'linkedinPerson', 'linkedinCompany', 'googleBusiness', 'catalog', 'synthesis'] as const
export type CollectorId = (typeof COLLECTOR_IDS)[number]

export type CollectorBilling = 'free' | 'firecrawl' | 'apify' | 'llm'

export const COLLECTOR_CATALOG: Record<CollectorId, { label: string; description: string; billing: CollectorBilling }> = {
    dns: { label: 'DNS', description: 'MX, SPF et jetons de vérification TXT : messagerie et outils SaaS', billing: 'free' },
    stack: { label: 'Stack du site', description: 'HTML brut de la home : CMS, analytics, chat, paiement, prise de RDV', billing: 'free' },
    site: { label: 'Site profond', description: 'Plan du site puis jusqu’à 8 pages clés, liens sociaux et branding', billing: 'firecrawl' },
    search: { label: 'Recherche web', description: 'La personne sur LinkedIn, la presse, les alternatives', billing: 'firecrawl' },
    registry: { label: 'Registre (FR)', description: 'SIREN, NAF, effectif, dirigeants, chiffre d’affaires', billing: 'free' },
    linkedinPerson: { label: 'LinkedIn : la personne', description: 'Profil, poste, parcours', billing: 'apify' },
    linkedinCompany: { label: 'LinkedIn : l’entreprise', description: 'Effectif, siège, spécialités, abonnés', billing: 'apify' },
    googleBusiness: { label: 'Google Business', description: 'Note, avis, catégorie, horaires', billing: 'apify' },
    catalog: { label: 'Catalogue produits', description: 'Si c’est une boutique : nombre de produits, collections et jusqu’à 25 fiches phares', billing: 'firecrawl' },
    synthesis: { label: 'Synthèse', description: 'Carte de visite et brief sourcé', billing: 'llm' },
}

export const companyLabRequestSchema = z.object({
    website: z.string().trim().min(1, 'Le site est requis'),
    personName: z.string().trim().max(120),
    email: z.string().trim().max(200),
    linkedinUrl: z.string().trim().max(300),
    collectors: z.array(z.enum(COLLECTOR_IDS)),
})

export type CompanyLabRequest = z.infer<typeof companyLabRequestSchema>
