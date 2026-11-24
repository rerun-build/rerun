import { visit } from '../steps.mjs'

// The library's front page lists the creators of the real catalog: the scene opens one of the demo's
// own templates, and frames that.
export default {
    page: 'templates/install',
    watches: ['apps/ui/components/templates/TemplateLibraryDialog.tsx', 'apps/ui/components/templates/TemplateDetailPanel.tsx', 'apps/ui/components/templates/TemplateDetailUseCases.tsx', 'packages/i18n/messages/en/templates.json'],
    shots: [
        {
            name: 'template-detail',
            height: 1700,
            open: async ({ page, base }) => {
                await visit(page, base, '/')
                await page.getByRole('button', { name: 'Template', exact: true }).first().click()
                // The library stops growing at 56rem and would cut the text of the template.
                await page.addStyleTag({ content: '[role="dialog"] > div[class*="56rem"] { height: 1500px !important; }' })
                await page.getByText('Agency growth team', { exact: true }).first().click()
            },
            ready: ({ page }) => page.getByText('Booker', { exact: true }).first(),
            // The text of the template, from its title to the apps it needs, without the library around it.
            frame: ({ page }) => page.getByText('Setup time', { exact: true }).locator('xpath=ancestor::*[.//*[text()="Google Calendar"]][1]'),
        },
    ],
}
