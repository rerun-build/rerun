import type Stripe from 'stripe'
import { ADDON_KEYS, INCLUDED_MACHINE_SIZE, compareMachineSizes, largerMachineSize, parseMachineSize, type AddonQuantities, type MachineSize } from './plans'
import { addonForPriceId, intervalOfItems, machineOfItems, machinePriceId, priceIdForAddon, quantitiesFromItems } from './stripe'

// Shape both the subscription update and the invoice preview accept, so a single diff can
// feed the two calls: quoting a price from one set of items and charging another is how a
// confirmation dialog ends up lying about the amount.
export type PlanItemChange = { id?: string; price?: string; quantity?: number; deleted?: boolean }

// Split the move from what the subscription pays for to `target` into the items that cost more and
// the items that cost less. The machine is one item whose price is swapped: a larger size is an
// increase billed for the rest of the period, a smaller one a decrease. `endingTrial` reports the case
// where the change cuts a trial short: a trial bills nothing and prorates nothing, so an add-on bought
// during one would be charged for but only delivered at conversion.
export function planItemChanges(subscription: Stripe.Subscription, target: { quantities: AddonQuantities; machineSize: MachineSize }): { increases: PlanItemChange[]; decreases: PlanItemChange[]; endingTrial: boolean } {
    const { quantities: current } = quantitiesFromItems(subscription.items.data)
    const interval = intervalOfItems(subscription.items.data)

    const itemIdByAddon = new Map<string, string>()
    for (const item of subscription.items.data) {
        const addon = addonForPriceId(item.price?.id)
        if (addon) itemIdByAddon.set(addon, item.id)
    }

    const increases: PlanItemChange[] = []
    const decreases: PlanItemChange[] = []
    for (const key of ADDON_KEYS) {
        if (target.quantities[key] === current[key]) continue
        const existingItemId = itemIdByAddon.get(key)
        const item: PlanItemChange = existingItemId
            ? target.quantities[key] === 0
                ? { id: existingItemId, deleted: true }
                : { id: existingItemId, quantity: target.quantities[key] }
            : { price: priceIdForAddon(key, interval), quantity: target.quantities[key] }
        ;(target.quantities[key] > current[key] ? increases : decreases).push(item)
    }

    const machine = machineOfItems(subscription.items.data)
    const machineChange = compareMachineSizes(target.machineSize, machine.size)
    if (machineChange !== 0) {
        const item: PlanItemChange =
            target.machineSize === INCLUDED_MACHINE_SIZE
                ? { id: machine.item!.id, deleted: true }
                : machine.item
                  ? { id: machine.item.id, price: machinePriceId(target.machineSize, interval), quantity: 1 }
                  : { price: machinePriceId(target.machineSize, interval), quantity: 1 }
        ;(machineChange > 0 ? increases : decreases).push(item)
    }

    return { increases, decreases, endingTrial: subscription.status === 'trialing' && increases.length > 0 }
}

export type MachineColumns = { machine_size: MachineSize; storage_packs: number }

// What a subscription pays for on the machine, written on the workspace. Like the limits, a larger size
// or more storage lands at once and a smaller one is held until the period advances: the machine keeps
// what was paid for.
export function machineColumns(items: Stripe.SubscriptionItem[], existing: { machine_size: string; storage_packs: number } | null, { held }: { held: boolean }): MachineColumns {
    const derived = { machine_size: machineOfItems(items).size, storage_packs: quantitiesFromItems(items).quantities.storage_pack }
    if (!held || !existing) return derived
    return { machine_size: largerMachineSize(parseMachineSize(existing.machine_size), derived.machine_size), storage_packs: Math.max(existing.storage_packs, derived.storage_packs) }
}
