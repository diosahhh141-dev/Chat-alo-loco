-- Run this complete file once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  bio text not null default '' check (char_length(bio) <= 240),
  avatar_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{3,24}$'),
  password_hash text not null,
  admin_key_hash text,
  created_by uuid not null references auth.users(id) on delete cascade,
  admin_only boolean not null default false,
  announcement text not null default '',
  created_at timestamptz not null default now()
);
alter table public.rooms add column if not exists admin_only boolean not null default false;
alter table public.rooms add column if not exists announcement text not null default '';

create table if not exists public.room_members (
  room_code text not null references public.rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_code, user_id)
);

create table if not exists public.room_admins (
  room_code text not null references public.rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (room_code, user_id)
);

create table if not exists public.room_bans (
  room_code text not null references public.rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_code, user_id)
);

create table if not exists public.room_mutes (
  room_code text not null references public.rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_code, user_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null default '',
  body text not null default '' check (char_length(body) <= 500),
  image_data text,
  reply_to_id uuid references public.chat_messages(id) on delete set null,
  is_creator boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  check (body <> '' or image_data is not null),
  check (image_data is null or char_length(image_data) <= 1400000)
);

create index if not exists chat_messages_room_created_idx on public.chat_messages(room_code, created_at desc);
alter table public.chat_messages add column if not exists is_admin boolean not null default false;

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  caption text not null default '' check (char_length(caption) <= 180),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (expires_at <= created_at + interval '24 hours')
);

create index if not exists stories_active_idx on public.stories(expires_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  room_code text,
  message_id uuid references public.chat_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  chosen_name text;
begin
  chosen_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), split_part(new.email, '@', 1));
  insert into public.profiles(id, username)
  values (new.id, lower(left(chosen_name, 24)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

create or replace function public.set_message_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select p.username into new.username from public.profiles p where p.id = auth.uid();
  new.user_id := auth.uid();
  new.is_creator := exists (
    select 1 from public.rooms r where r.code = new.room_code and r.created_by = auth.uid()
  );
  new.is_admin := new.is_creator or exists (
    select 1 from public.room_admins a where a.room_code = new.room_code and a.user_id = auth.uid()
  );
  return new;
end;
$$;

create or replace function public.can_send_room_message(p_code text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.code = p_code
      and (not r.admin_only or r.created_by = auth.uid() or exists (
        select 1 from public.room_admins a where a.room_code = r.code and a.user_id = auth.uid()
      ))
      and not exists (select 1 from public.room_bans b where b.room_code = r.code and b.user_id = auth.uid())
      and not exists (select 1 from public.room_mutes m where m.room_code = r.code and m.user_id = auth.uid())
  );
$$;
revoke all on function public.can_send_room_message(text) from public, anon;
grant execute on function public.can_send_room_message(text) to authenticated;

drop trigger if exists stamp_chat_message on public.chat_messages;
create trigger stamp_chat_message before insert on public.chat_messages
for each row execute procedure public.set_message_identity();

create or replace function public.notify_room_members()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, title, body, room_code, message_id)
  select m.user_id, new.username || ' envió un mensaje',
         case when new.body <> '' then left(new.body, 140) else 'Compartió una imagen' end,
         new.room_code, new.id
  from public.room_members m
  where m.room_code = new.room_code and m.user_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists notify_after_chat_message on public.chat_messages;
create trigger notify_after_chat_message after insert on public.chat_messages
for each row execute procedure public.notify_room_members();

create or replace function public.enter_room(p_code text, p_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  room_row public.rooms%rowtype;
  did_create boolean := false;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para entrar a una sala.'; end if;
  if p_code !~ '^[A-Za-z0-9_-]{3,24}$' then raise exception 'El código debe tener de 3 a 24 letras o números.'; end if;
  if char_length(p_password) < 4 then raise exception 'La contraseña de sala debe tener al menos 4 caracteres.'; end if;

  select * into room_row from public.rooms where code = upper(p_code) for update;
  if not found then
    insert into public.rooms(code, password_hash, created_by)
    values (upper(p_code), crypt(p_password, gen_salt('bf')), auth.uid())
    returning * into room_row;
    did_create := true;
  elsif crypt(p_password, room_row.password_hash) <> room_row.password_hash then
    raise exception 'La contraseña de esa sala no es correcta.';
  end if;

  insert into public.room_members(room_code, user_id)
  values (room_row.code, auth.uid()) on conflict do nothing;
  return jsonb_build_object('ok', true, 'created', did_create, 'code', room_row.code);
end;
$$;

create or replace function public.authorize_room_admin(p_code text, p_key text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  room_row public.rooms%rowtype;
  is_admin boolean := false;
begin
  select * into room_row from public.rooms where code = upper(p_code) for update;
  if not found then return jsonb_build_object('authorized', false); end if;
  if room_row.admin_key_hash is null then
    if room_row.created_by <> p_user_id or char_length(p_key) < 8 then
      return jsonb_build_object('authorized', false);
    end if;
    update public.rooms set admin_key_hash = crypt(p_key, gen_salt('bf')) where code = room_row.code;
    is_admin := true;
  else
    is_admin := crypt(p_key, room_row.admin_key_hash) = room_row.admin_key_hash;
  end if;
  if is_admin then
    insert into public.room_admins(room_code, user_id) values (room_row.code, p_user_id) on conflict do nothing;
  end if;
  return jsonb_build_object('authorized', is_admin);
end;
$$;

revoke all on function public.authorize_room_admin(text, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_room_admin(text, text, uuid) to service_role;

create or replace function public.set_story_expiration()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.expires_at := new.created_at + interval '24 hours';
  return new;
end;
$$;

drop trigger if exists story_expires_after_24h on public.stories;
create trigger story_expires_after_24h before insert on public.stories
for each row execute procedure public.set_story_expiration();

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_admins enable row level security;
alter table public.room_bans enable row level security;
alter table public.room_mutes enable row level security;
alter table public.chat_messages enable row level security;
alter table public.stories enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Signed-in users can see profiles" on public.profiles;
create policy "Signed-in users can see profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "Users edit their own profile" on public.profiles;
create policy "Users edit their own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Members can see their membership" on public.room_members;
create policy "Members can see their membership" on public.room_members for select to authenticated using (user_id = auth.uid());
drop policy if exists "Admins can see their admin role" on public.room_admins;
create policy "Admins can see their admin role" on public.room_admins for select to authenticated using (user_id = auth.uid());

drop policy if exists "Room members read chat history" on public.chat_messages;
create policy "Room members read chat history" on public.chat_messages for select to authenticated
using (exists (select 1 from public.room_members m where m.room_code = chat_messages.room_code and m.user_id = auth.uid()));
drop policy if exists "Room members send messages" on public.chat_messages;
create policy "Room members send messages" on public.chat_messages for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.room_members m where m.room_code = chat_messages.room_code and m.user_id = auth.uid()) and public.can_send_room_message(room_code));
drop policy if exists "Users delete their own messages" on public.chat_messages;
create policy "Users delete their own messages" on public.chat_messages for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Signed-in users see active stories" on public.stories;
create policy "Signed-in users see active stories" on public.stories for select to authenticated
using (expires_at > now() or user_id = auth.uid());
drop policy if exists "Users publish their own stories" on public.stories;
create policy "Users publish their own stories" on public.stories for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users delete their own stories" on public.stories;
create policy "Users delete their own stories" on public.stories for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Users read their notifications" on public.notifications;
create policy "Users read their notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users mark their notifications read" on public.notifications;
create policy "Users mark their notifications read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update on public.profiles to authenticated;
grant select on public.room_members, public.room_admins to authenticated;
grant select, insert, delete on public.chat_messages to authenticated;
grant select, insert, delete on public.stories to authenticated;
grant select, update on public.notifications to authenticated;
grant execute on function public.enter_room(text, text) to authenticated;
grant all on public.profiles, public.rooms, public.room_members, public.room_admins, public.room_bans, public.room_mutes, public.chat_messages, public.stories, public.notifications to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict (id) do update set public = false, file_size_limit = 52428800,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_view_media(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.avatar_path = object_name)
      or exists (select 1 from public.stories s where s.media_path = object_name and s.expires_at > now());
$$;

drop policy if exists "Users upload their own media" on storage.objects;
create policy "Users upload their own media" on storage.objects for insert to authenticated
with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users view own or shared active media" on storage.objects;
create policy "Users view own or shared active media" on storage.objects for select to authenticated
using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.can_view_media(name)));
drop policy if exists "Users replace their own media" on storage.objects;
create policy "Users replace their own media" on storage.objects for update to authenticated
using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users remove their own media" on storage.objects;
create policy "Users remove their own media" on storage.objects for delete to authenticated
using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;
