// How long the archive of a paused workspace is kept before it is deleted for good.
export const ARCHIVE_RETENTION_DAYS = 90

// How long each nightly backup of a paying workspace is kept, and the one of the night from Saturday
// to Sunday. The same delays bound how long a deleted account's data outlives it in the backups.
export const BACKUP_RETENTION_DAYS = 7
export const WEEKLY_BACKUP_RETENTION_DAYS = 28
