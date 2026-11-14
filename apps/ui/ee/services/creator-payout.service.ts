import { type SaleSplit, splitSale } from '@rerun/contracts'
import type Stripe from 'stripe'
import { stripe } from '@/ee/lib/billing/stripe'

type TransferParams = {
    chargeId: string | null
    connectedAccountId: string | null
    grossCents: number
    taxCents: number
    currency: string
    metadata: Stripe.MetadataParam
}

export async function transferSaleToCreator(params: TransferParams): Promise<SaleSplit & { transferId: string | null }> {
    const split = splitSale(params.grossCents, params.taxCents)
    if (!params.chargeId || !params.connectedAccountId || split.netCents <= 0) return { ...split, transferId: null }

    const settled = await settledTransferAmount(params.chargeId, split.netCents, params.currency)
    const transfer = await stripe.transfers.create(
        {
            amount: settled.amount,
            currency: settled.currency,
            destination: params.connectedAccountId,
            source_transaction: params.chargeId,
            metadata: params.metadata,
        },
        { idempotencyKey: `template-transfer-${params.chargeId}` },
    )

    return { ...split, transferId: transfer.id }
}

async function settledTransferAmount(chargeId: string, netCents: number, saleCurrency: string): Promise<{ amount: number; currency: string }> {
    const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] })
    const settlement = charge.balance_transaction
    if (!settlement || typeof settlement === 'string') throw new Error(`Charge ${chargeId} has not settled yet, the transfer will be retried.`)

    if (settlement.currency === saleCurrency || charge.amount <= 0) return { amount: netCents, currency: saleCurrency }
    return { amount: Math.round((netCents * settlement.amount) / charge.amount), currency: settlement.currency }
}

export async function reverseCreatorTransfer(transferId: string, refundedCents: number, chargedCents: number): Promise<number> {
    if (refundedCents <= 0 || chargedCents <= 0) return 0

    const transfer = await stripe.transfers.retrieve(transferId)
    const target = refundedCents >= chargedCents ? transfer.amount : Math.round((transfer.amount * refundedCents) / chargedCents)
    const missing = target - transfer.amount_reversed
    if (missing <= 0) return 0

    await stripe.transfers.createReversal(
        transferId,
        { amount: missing },
        { idempotencyKey: `template-reversal-${transferId}-${refundedCents}` },
    )
    return missing
}
