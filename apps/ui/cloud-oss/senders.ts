const RESEND_TEST_SENDER = 'Rerun <onboarding@resend.dev>'

export const DEFAULT_SENDERS: { transactional: string; experts: string; marketing: string; replyTo: string | undefined } = {
    transactional: RESEND_TEST_SENDER,
    experts: RESEND_TEST_SENDER,
    marketing: RESEND_TEST_SENDER,
    replyTo: undefined,
}

export const DEFAULT_WHATSAPP_FROM: string | null = null
