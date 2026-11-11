## What changes

<!-- One or two sentences. Link the issue it closes. -->

## How you tested it

<!-- What you tried on the change itself: every way in, state, person and failure, what passed, what
failed and was fixed, what could not be tried. Commands you ran, screens you checked (mobile and desktop for UI). -->

- [ ] `pnpm -r --if-present ts-check`, `pnpm --filter rerun lint` and the tests pass
- [ ] The change was tried inside out, the list is above
- [ ] The change comes with its unit tests and an end-to-end spec in `apps/ui/e2e/` (`pnpm test:e2e`), or this description says why none applies
- [ ] A change to the database comes as a new migration in `supabase/migrations/`
