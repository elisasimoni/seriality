-- Schema del backup cifrato di Seriality (vedi src/cloud.ts).
--
-- Il client arriva con un blob già cifrato e un id di slot derivato dalla
-- passphrase: il database non sa di chi siano i dati né cosa contengano.
-- La tabella sta in uno schema NON esposto da PostgREST e senza policy RLS,
-- quindi la chiave anon pubblica non può leggerla direttamente: si passa solo
-- dalle tre funzioni qui sotto.

create schema if not exists backup;

create table if not exists backup.snapshots (
  slot        text        not null,
  created_at  timestamptz not null default now(),
  payload     text        not null,   -- JSON {v,z,iv,data}: AES-GCM su gzip
  meta        jsonb       not null default '{}'::jsonb,  -- solo conteggi e data
  primary key (slot, created_at)
);

alter table backup.snapshots enable row level security;
-- nessuna policy: nessun accesso diretto per anon/authenticated

revoke all on schema backup from anon, authenticated;
revoke all on table backup.snapshots from anon, authenticated;

-- Quante versioni teniamo per slot (le più vecchie cadono da sole).
create or replace function backup.keep_versions() returns int
language sql immutable set search_path = pg_catalog, pg_temp as $$ select 5 $$;

/**
 * Carica una nuova versione e pota le eccedenti.
 * Lo slot deve essere un digest esadecimale: impedisce di riempire la tabella
 * con chiavi arbitrarie, e il limite di dimensione tiene fuori i payload assurdi.
 */
create or replace function public.backup_push(
  p_slot text, p_payload text, p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = backup, pg_temp as $$
declare v_count int;
begin
  if p_slot !~ '^[0-9a-f]{64}$' then
    raise exception 'slot non valido';
  end if;
  if length(p_payload) > 25000000 then
    raise exception 'backup troppo grande (max 25 MB)';
  end if;

  insert into backup.snapshots (slot, payload, meta) values (p_slot, p_payload, p_meta);

  delete from backup.snapshots s
   where s.slot = p_slot
     and s.created_at not in (
       select created_at from backup.snapshots
        where slot = p_slot order by created_at desc limit backup.keep_versions()
     );

  select count(*) into v_count from backup.snapshots where slot = p_slot;
  return jsonb_build_object('versions', v_count);
end $$;

/** Elenco delle versioni disponibili (senza scaricare i payload). */
create or replace function public.backup_list(p_slot text)
returns table (created_at timestamptz, bytes int, meta jsonb)
language sql security definer set search_path = backup, pg_temp as $$
  select s.created_at, length(s.payload), s.meta
    from backup.snapshots s
   where s.slot = p_slot
   order by s.created_at desc
$$;

/** Scarica una versione: quella indicata, o la più recente se p_at è null. */
create or replace function public.backup_pull(p_slot text, p_at timestamptz default null)
returns text
language sql security definer set search_path = backup, pg_temp as $$
  select s.payload
    from backup.snapshots s
   where s.slot = p_slot
     and (p_at is null or s.created_at = p_at)
   order by s.created_at desc
   limit 1
$$;

revoke all on function public.backup_push(text, text, jsonb) from public;
revoke all on function public.backup_list(text) from public;
revoke all on function public.backup_pull(text, timestamptz) from public;

grant execute on function public.backup_push(text, text, jsonb) to anon;
grant execute on function public.backup_list(text) to anon;
grant execute on function public.backup_pull(text, timestamptz) to anon;
