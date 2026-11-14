import type { UIMessage } from 'ai'

type Part = UIMessage['parts'][number]

const RESTAURANTS = ['Le Bouchon des Filles', 'Café Comptoir Abel', 'Daniel et Denise', 'Le Kitchen Café', 'Les Halles de Lyon', 'La Mère Brazier', 'Le Sud', 'Brasserie Georges', 'Le Neuvième Art', 'Takao Takano', 'Têtedoie', 'Le Passe Temps', 'Substrat', 'Café Sillon', 'Le Bistrot du Potager', 'Prairial', 'Le Garet', 'Chez Paul', 'La Sommelière', 'Le Comptoir du Vin']

const PEOPLE = Array.from({ length: 22 }, (_, i) => ({ full_name: `Owner ${i + 1}`, company: RESTAURANTS[i % RESTAURANTS.length] }))

const EMAILS: { full_name: string; domain: string; email: string | null; verdict: string | null }[] = [
    { full_name: 'Camille Rousset', domain: 'bouchondesfilles.fr', email: 'camille@bouchondesfilles.fr', verdict: 'valid' },
    { full_name: 'Julien Abel', domain: 'cafecomptoirabel.com', email: 'julien@cafecomptoirabel.com', verdict: 'valid' },
    { full_name: 'Denise Morel', domain: 'danieletdenise.fr', email: 'contact@danieletdenise.fr', verdict: 'accept_all' },
    { full_name: 'Sarah Kitchen', domain: 'lekitchencafe.com', email: 'sarah@lekitchencafe.com', verdict: 'valid' },
    { full_name: 'Paul Garet', domain: 'legaret.fr', email: null, verdict: null },
    { full_name: 'Mathieu Viannay', domain: 'lamerebrazier.fr', email: 'mathieu@lamerebrazier.fr', verdict: 'valid' },
]

const call = (id: string, capability: string, params: Record<string, unknown>, output: Record<string, unknown>): Part => ({ type: 'tool-paid_data', toolCallId: id, state: 'output-available', input: { capability, params }, output }) as unknown as Part

const mapsCall = call(
    'paid-maps',
    'google.serp.maps',
    { q: 'restaurants Lyon 2', limit: 20 },
    { status: 'found', billedMicros: 3_000, message: '20 places', servedBy: 'crawl4ai.google.serp.maps', result: { output: { places: RESTAURANTS.map((name, i) => ({ position: i + 1, name })) } } }
)

const searchCall = call(
    'paid-search',
    'people.search',
    { q: 'restaurant owners in Lyon 2', limit: 25 },
    { status: 'found', billedMicros: 220_000, message: `${PEOPLE.length} people`, servedBy: 'quickenrich.people.search', result: { output: { people: PEOPLE } } }
)

const emailCalls = EMAILS.map(({ full_name, domain, email, verdict }, i) =>
    call(
        `paid-email-${i}`,
        'people.email.find',
        { full_name, domain },
        email
            ? { status: 'found', billedMicros: 30_000, message: email, servedBy: 'hunter.people.email.find', result: { output: { email }, verification: { verdict } } }
            : { status: 'nothing_found', billedMicros: 0, message: 'No email found', servedBy: 'hunter.people.email.find', result: { output: null } }
    )
)

export const PAID_DATA_TURN: UIMessage[] = [
    { id: 'paid-user', role: 'user', parts: [{ type: 'text', text: 'Find me restaurant owners in Lyon 2 with their work email.' }] },
    {
        id: 'paid-assistant',
        role: 'assistant',
        parts: [mapsCall, searchCall, ...emailCalls, { type: 'text', text: 'Done. I found 20 restaurants, 22 owners and a work email for 5 of the 6 I looked up. 4 checked valid. They are in your leads table.' } as Part],
    },
]
