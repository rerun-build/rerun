-- Le disque de chaque box, vu depuis la box (`df /`), ajouté à l'échantillon qu'envoie l'hôte chaque
-- minute. Une box pleine casse sans bruit (écritures SQLite, self-update): l'admin les classe par
-- remplissage. Null quand la box est arrêtée ou que la mesure a échoué.
alter table "public"."engine_box_metrics"
    add column "disk_used_mb" integer,
    add column "disk_total_mb" integer;

-- La dernière mesure de disque de chaque box. Seulement la dernière demi-heure: une box qui ne
-- mesure plus rien est arrêtée ou détruite, et l'index (host_id, sampled_at) garde la lecture courte.
create or replace function public.engine_box_disk_latest()
returns table (host_id uuid, box_name text, sampled_at timestamptz, disk_used_mb integer, disk_total_mb integer)
language sql
stable
security invoker
set search_path = ''
as $$
    select distinct on (m.host_id, m.box_name)
        m.host_id,
        m.box_name,
        m.sampled_at,
        m.disk_used_mb,
        m.disk_total_mb
    from public.engine_box_metrics m
    where m.sampled_at >= now() - interval '30 minutes'
        and m.disk_used_mb is not null
        and m.disk_total_mb > 0
    order by m.host_id, m.box_name, m.sampled_at desc
$$;

revoke execute on function public.engine_box_disk_latest() from public, anon, authenticated;
grant execute on function public.engine_box_disk_latest() to service_role;
