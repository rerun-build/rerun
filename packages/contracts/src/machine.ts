// The size of the machine a workspace runs on. Every workspace has one machine, shared by all its
// coworkers: the sizes say what it gets. A size added later (an XL) is one more entry here and one
// more value in the check constraints of `workspaces.machine_size` and `engine_pool.machine_size`.
export const MACHINE_SIZES = ['small', 'medium', 'large'] as const

export type MachineSize = (typeof MACHINE_SIZES)[number]

// What the plan comes with. Nothing to pay for it, so it carries no item on the subscription.
export const INCLUDED_MACHINE_SIZE = 'small' satisfies MachineSize

export type PaidMachineSize = Exclude<MachineSize, typeof INCLUDED_MACHINE_SIZE>

export const PAID_MACHINE_SIZES = MACHINE_SIZES.filter((size): size is PaidMachineSize => size !== INCLUDED_MACHINE_SIZE)

export type MachineSpec = {
    vcpus: number
    memoryGib: number
    diskGib: number
    // What the offer says about backups, null for none. Only words on a screen: every paid workspace is
    // backed up the same way whatever its size.
    shownBackupDays: number | null
}

export const MACHINE_SPECS: Record<MachineSize, MachineSpec> = {
    small: { vcpus: 2, memoryGib: 8, diskGib: 20, shownBackupDays: null },
    medium: { vcpus: 4, memoryGib: 16, diskGib: 60, shownBackupDays: 7 },
    large: { vcpus: 8, memoryGib: 32, diskGib: 150, shownBackupDays: 30 },
}

// Storage is sold on top of any size, by packs.
export const STORAGE_PACK_GIB = 50

export const MAX_STORAGE_PACKS = 10

export function isMachineSize(value: unknown): value is MachineSize {
    return typeof value === 'string' && (MACHINE_SIZES as readonly string[]).includes(value)
}

// The columns are plain text: anything else reads as the included size.
export function parseMachineSize(value: string | null | undefined): MachineSize {
    return isMachineSize(value) ? value : INCLUDED_MACHINE_SIZE
}

// Below zero when `a` is the smaller of the two, in the order of MACHINE_SIZES.
export function compareMachineSizes(a: MachineSize, b: MachineSize): number {
    return MACHINE_SIZES.indexOf(a) - MACHINE_SIZES.indexOf(b)
}

export function largerMachineSize(a: MachineSize, b: MachineSize): MachineSize {
    return compareMachineSizes(a, b) >= 0 ? a : b
}

// The disk a machine of `size` holding `storagePacks` packs has.
export function machineDiskGib(size: MachineSize, storagePacks: number): number {
    return MACHINE_SPECS[size].diskGib + storagePacks * STORAGE_PACK_GIB
}

// What the machine of a workspace really has, read off the machine rather than the bill: a size
// just bought shows here once the resize is done. `usedDiskGib` is null until the machine reported it.
export type MachineReading = { size: MachineSize; diskGib: number; usedDiskGib: number | null }

// A smaller disk is only taken when what the machine holds today fills at most this share of it: the
// move to a smaller machine copies everything across, and a full disk stops the coworkers.
export const MACHINE_DISK_FILL_LIMIT = 0.8

export function fitsOnDisk(usedDiskGib: number | null, diskGib: number): boolean {
    return usedDiskGib === null || usedDiskGib <= diskGib * MACHINE_DISK_FILL_LIMIT
}
