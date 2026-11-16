# @rerun/emails

The emails Rerun sends, written with React Email: sign-in codes, invitations, coworker notifications,
failed runs, the trial and billing notices, the newsletters. One template per file in `emails/`
(newsletters in `emails/newsletters/`), the shared blocks in `components/`, the colors in `theme.ts`.
`renderEmail()` (`src/render.ts`) turns a template into its HTML and plain-text bodies.

The Supabase auth emails are not here: they are `supabase/templates/*.html`.

## Who imports it

`apps/ui`, which renders and sends them. A self-hosted install sends through its own Resend account
(`RESEND_API_KEY`, `RESEND_FROM`); without one, nothing is sent (`apps/ui/cloud-oss/email.ts`).

## Preview

```bash
pnpm dev:emails    # the React Email preview, on http://localhost:3060
```

Each template's `PreviewProps` feed the preview. The images (logo, banners, icons) are drawn by the
hub's `/email/*` routes, so run `pnpm dev:ui` beside it: the preview points them at
`http://localhost:3050` (or `CONDUCTOR_PORT`), and `EMAIL_ASSET_ORIGIN` overrides that.

## Test and check

```bash
pnpm --filter rerun test lib/email/templates.test.ts   # every preview renders, in English and French
pnpm --filter @rerun/emails ts-check
```

The tests live in the hub and walk `EMAIL_PREVIEWS` (`src/previews.tsx`): a new template gets a preview
there. They refuse flexbox, colors with alpha and colors missing from `theme.ts`, which mail clients
render badly.

## Rules

- Text goes through `emailTranslator(locale)` (`i18n.ts`), from the `emails` namespace of
  `packages/i18n/messages/en/emails.json`. Every template of `emails/` takes a `locale`; the
  newsletters are written in English only.
- A sent email resolves its images against the production host, never `localhost`: only the preview
  overrides `ASSET_ORIGIN` (`assets.ts`). When the artwork changes, bump `ART_VERSION`.
