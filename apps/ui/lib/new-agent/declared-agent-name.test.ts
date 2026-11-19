import { describe, expect, it } from 'vitest'

import { declaredAgentName } from '@moldwright/ui/new-agent'

const GIG_APPLIER = `You are Gig Applier, working for Haroon Haneef, a remote job seeker. Your job is to apply to AI training gig platforms and log every application in the shared tracker.`
const TRACKER = `You are Tracker, working for Haroon Haneef. You own the central job application tracker.`

describe('declaredAgentName', () => {
    it('reads the name a brief gives its coworker', () => {
        expect(declaredAgentName(GIG_APPLIER)).toBe('Gig Applier')
        expect(declaredAgentName(TRACKER)).toBe('Tracker')
    })

    it('reads the other ways a brief introduces its coworker', () => {
        expect(declaredAgentName("You're LinkedIn Applier. You apply through Easy Apply.")).toBe('LinkedIn Applier')
        expect(declaredAgentName('You are the Boards Applier — you apply on job boards.')).toBe('Boards Applier')
        expect(declaredAgentName('Your name is Inbox Triage and you sort the inbox.')).toBe('Inbox Triage')
        expect(declaredAgentName('**You are Gig Applier**, working for Haroon.')).toBe('Gig Applier')
        expect(declaredAgentName('Tu es Veille Concurrence, tu suis les prix des concurrents.')).toBe('Veille Concurrence')
        expect(declaredAgentName("Tu es l'Assistant RH de l'équipe.")).toBe('Assistant RH')
        expect(declaredAgentName('You are the Tracker, you own the tracker.')).toBe('Tracker')
    })

    it('does not take the role a brief describes for a name', () => {
        expect(declaredAgentName('You are an AI assistant that sorts my inbox.')).toBeNull()
        expect(declaredAgentName('You are an SEO expert. Write one article per week.')).toBeNull()
        expect(declaredAgentName('You are a LinkedIn outreach specialist for Acme.')).toBeNull()
        expect(declaredAgentName('You are the Head of Sales at Acme.')).toBeNull()
        expect(declaredAgentName('You are a Shopify store manager')).toBeNull()
    })

    it('reads the title of a pasted SOUL, past a heading that only titles the document', () => {
        expect(declaredAgentName('# Inbox Triage\n\nYou sort the inbox every morning.')).toBe('Inbox Triage')
        expect(declaredAgentName('# SOUL\nYou are Tracker, working for Haroon.')).toBe('Tracker')
    })

    it('names no one when the brief does not', () => {
        expect(declaredAgentName('You are a helpful assistant that sorts my inbox.')).toBeNull()
        expect(declaredAgentName('You are working for Haroon, applying to jobs.')).toBeNull()
        expect(declaredAgentName("You are Haroon's assistant for job applications.")).toBeNull()
        expect(declaredAgentName('Tu es un expert en SEO.')).toBeNull()
        expect(declaredAgentName('Every morning, sort our hello@ inbox and tell us in Slack.')).toBeNull()
        expect(declaredAgentName('# How to apply\nRead the job post first.')).toBeNull()
        expect(declaredAgentName('')).toBeNull()
    })

    it('does not take a whole sentence of capitalised words for a name', () => {
        expect(declaredAgentName('You are The Best Remote Job Hunter Ever, working for me.')).toBeNull()
    })
})
