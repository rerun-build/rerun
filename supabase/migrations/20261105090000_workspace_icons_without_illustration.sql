-- A self-hosted install ships the `blob-illustrations` bucket empty, yet every workspace used to be
-- given one of its files as a logo: the app showed a broken image in its place. A workspace may now
-- have no icon, and such a dead link is cleared so the app falls back on its default mark. On Rerun
-- Cloud every file is in the bucket and no row matches.
alter table public.workspaces alter column icon_url drop not null;

update public.workspaces w
set icon_url = null
where w.icon_url like '%/blob-illustrations/%'
    and not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'blob-illustrations'
            and o.name = regexp_replace(w.icon_url, '^.*/blob-illustrations/', '')
    );
