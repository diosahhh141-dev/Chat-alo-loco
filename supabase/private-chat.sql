-- Ejecuta una sola vez en Supabase > SQL Editor.
create table if not exists public.dm_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);
create unique index if not exists dm_requests_one_pending_pair_idx on public.dm_requests (least(requester_id,recipient_id),greatest(requester_id,recipient_id)) where status='pending';
create unique index if not exists dm_requests_one_accepted_pair_idx on public.dm_requests (least(requester_id,recipient_id),greatest(requester_id,recipient_id)) where status='accepted';
create index if not exists dm_requests_recipient_status_idx on public.dm_requests (recipient_id,status,updated_at desc);
create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.dm_requests(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_request_created_idx on public.dm_messages (request_id,created_at);
alter table public.dm_requests enable row level security;
alter table public.dm_messages enable row level security;
drop policy if exists "Participants see their private requests" on public.dm_requests;
create policy "Participants see their private requests" on public.dm_requests for select to authenticated using (requester_id=auth.uid() or recipient_id=auth.uid());
drop policy if exists "Users send private chat requests" on public.dm_requests;
create policy "Users send private chat requests" on public.dm_requests for insert to authenticated with check (requester_id=auth.uid() and status='pending' and requester_id<>recipient_id);
drop policy if exists "Recipients answer pending private requests" on public.dm_requests;
create policy "Recipients answer pending private requests" on public.dm_requests for update to authenticated using (recipient_id=auth.uid() and status='pending') with check (recipient_id=auth.uid() and status in ('accepted','declined'));
drop policy if exists "Participants read accepted private messages" on public.dm_messages;
create policy "Participants read accepted private messages" on public.dm_messages for select to authenticated using (exists(select 1 from public.dm_requests r where r.id=dm_messages.request_id and r.status='accepted' and (r.requester_id=auth.uid() or r.recipient_id=auth.uid())));
drop policy if exists "Participants send accepted private messages" on public.dm_messages;
create policy "Participants send accepted private messages" on public.dm_messages for insert to authenticated with check (sender_id=auth.uid() and exists(select 1 from public.dm_requests r where r.id=dm_messages.request_id and r.status='accepted' and (r.requester_id=auth.uid() or r.recipient_id=auth.uid())));
grant select,insert on public.dm_requests to authenticated;
grant update(status,updated_at) on public.dm_requests to authenticated;
grant select,insert on public.dm_messages to authenticated;
grant all on public.dm_requests,public.dm_messages to service_role;
do $$ begin alter publication supabase_realtime add table public.dm_requests; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.dm_messages; exception when duplicate_object then null; end $$;
