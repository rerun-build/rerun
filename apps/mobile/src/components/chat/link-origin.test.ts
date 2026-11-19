import { excerptOf } from './link-origin'

describe('excerptOf', () => {
    it('reads the message as one plain line, links as their words', () => {
        expect(excerptOf('Done. I drafted the follow-up in [HubSpot](https://app.hubspot.com) and moved the deal to **Negotiation**.')).toBe('Done. I drafted the follow-up in HubSpot and moved the deal to Negotiation.')
    })

    it('keeps only the word that replaced a struck one', () => {
        expect(excerptOf('The pipeline grew by 12 leads, ~~9~~ 11 of them from LinkedIn.')).toBe('The pipeline grew by 12 leads, 11 of them from LinkedIn.')
        expect(excerptOf('Meet at ~3pm~ 4pm.')).toBe('Meet at 4pm.')
    })

    it('leaves a lone tilde alone', () => {
        expect(excerptOf('About ~5 minutes, files in ~/reports.')).toBe('About ~5 minutes, files in ~/reports.')
    })
})
