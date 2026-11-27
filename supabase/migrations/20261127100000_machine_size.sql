-- Every workspace runs on one machine, now sold in sizes (`MACHINE_SIZES` in @rerun/contracts), with
-- storage on top by packs of 50 GB.
--
-- On the workspace, what is paid for: the webhook writes it from the subscription, and holds a
-- smaller size or fewer packs until the renewal, like the app slots. On the engine, what the machine
-- really has: a difference between the two is a resize still to do. A size added later is one more
-- value in both checks.
alter table public.workspaces
    add column if not exists machine_size text not null default 'small' constraint workspaces_machine_size_check check (machine_size in ('small', 'medium', 'large')),
    add column if not exists storage_packs smallint not null default 0 constraint workspaces_storage_packs_check check (storage_packs between 0 and 10);

alter table public.engine_pool
    add column if not exists machine_size text not null default 'small' constraint engine_pool_machine_size_check check (machine_size in ('small', 'medium', 'large')),
    add column if not exists disk_gib smallint not null default 20 constraint engine_pool_disk_gib_check check (disk_gib > 0);

-- What each box really has, as its host reports it every minute: for the team to compare with what the
-- pool recorded (a box enlarged by hand before the sizes were sold), never used to resize or move a box.
alter table public.engine_box_metrics
    add column if not exists vcpus smallint,
    add column if not exists memory_gib smallint,
    add column if not exists root_gib smallint;

-- A box made smaller moves onto a fresh one through an archive and a restore.
alter type public.workspace_archive_reason add value if not exists 'resize';
