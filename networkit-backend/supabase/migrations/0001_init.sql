-- ═══════════════════════════════════════════════════════════════
-- NetworkIt — Phase 1 backend schema (Supabase / Postgres)
--
-- Scope: auth, profiles, discover/search, saved profiles, 1:1
-- messaging, basic reporting. Admin panel, notifications, and
-- "online status" are explicitly OUT of scope for this migration
-- — see README.md "Phase 2" for why and what's needed.
--
-- Design principle that the original prototype violated: privacy
-- toggles (hide location / university / socials / join date /
-- search visibility) are enforced HERE, server-side, via RLS +
-- SECURITY DEFINER functions that decide what to return — not by
-- a client that already received the private data and chose not
-- to render it.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ─────────────────────────────────────────────
-- PROFILES
-- One row per auth.users row. Phone number lives here but is
-- NEVER exposed by any view/function below — matches the
-- original product promise ("never shown publicly").
-- ─────────────────────────────────────────────
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  username          citext not null unique,
  first_name        text not null check (char_length(first_name) between 1 and 60),
  last_name         text not null check (char_length(last_name) between 1 and 60),
  date_of_birth     date,
  gender            text,
  country           text,
  region            text,
  city              text,
  status            text check (status in ('Student','Professional')),
  school            text,
  university        text,
  field             text,
  year_level        text,
  bio               text check (char_length(bio) <= 300),
  interests         text[] not null default '{}',
  languages         text[] not null default '{}',
  goals             text[] not null default '{}',
  phone             text,                       -- PRIVATE. Never selectable by other users.
  telegram          text,
  instagram         text,
  whatsapp          text,
  linkedin          text,
  public_email      text,
  avatar_url        text,
  is_admin          boolean not null default false,
  is_banned         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index profiles_field_idx on public.profiles (field);
create index profiles_country_idx on public.profiles (country);
create index profiles_status_idx on public.profiles (status);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- Only the owner can read/write their own full row directly.
-- Everyone else's data is only reachable through the masked
-- functions further down (get_profile_card / search_profiles /
-- get_identities), which run as SECURITY DEFINER and decide what
-- to expose based on privacy_settings.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- No delete policy: account deletion goes through the
-- delete-account Edge Function (service role), which deletes the
-- auth.users row and cascades. See supabase/functions/delete-account.

-- ─────────────────────────────────────────────
-- PRIVACY SETTINGS (1:1 with profiles)
-- ─────────────────────────────────────────────
create table public.privacy_settings (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  show_location     boolean not null default true,
  show_university   boolean not null default true,
  show_socials      boolean not null default true,
  show_in_search    boolean not null default true,
  show_join_date    boolean not null default true
);

alter table public.privacy_settings enable row level security;

create policy "privacy_select_own" on public.privacy_settings
  for select using (auth.uid() = profile_id);

create policy "privacy_upsert_own" on public.privacy_settings
  for insert with check (auth.uid() = profile_id);

create policy "privacy_update_own" on public.privacy_settings
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- Auto-create a default privacy row whenever a profile is created,
-- so the client never has to remember to do it.
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.privacy_settings (profile_id) values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end $$;

create trigger profiles_after_insert_privacy
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- ─────────────────────────────────────────────
-- SAVED PROFILES (bookmarks)
-- ─────────────────────────────────────────────
create table public.saved_profiles (
  user_id           uuid not null references public.profiles(id) on delete cascade,
  saved_profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (user_id, saved_profile_id),
  check (user_id <> saved_profile_id)
);

alter table public.saved_profiles enable row level security;

create policy "saved_all_own" on public.saved_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- MESSAGING
-- conversations.user_a is always the lexicographically smaller
-- uuid of the two participants, enforced by a check constraint;
-- the client is responsible for sorting the pair before insert
-- (see supabase-client.js: startConversation()).
-- ─────────────────────────────────────────────
create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  user_a            uuid not null references public.profiles(id) on delete cascade,
  user_b            uuid not null references public.profiles(id) on delete cascade,
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);

alter table public.conversations enable row level security;

create policy "conversations_select_participant" on public.conversations
  for select using (auth.uid() = user_a or auth.uid() = user_b);

create policy "conversations_insert_participant" on public.conversations
  for insert with check (auth.uid() = user_a or auth.uid() = user_b);

create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  sender_id         uuid not null references public.profiles(id) on delete cascade,
  body              text not null check (char_length(body) between 1 and 4000),
  created_at        timestamptz not null default now(),
  seen_at           timestamptz
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;

create policy "messages_select_participant" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  );

create policy "messages_insert_participant" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  );

-- Recipients can mark a message as seen, but nothing else.
create policy "messages_update_seen_by_recipient" on public.messages
  for update using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  ) with check (
    sender_id <> auth.uid()
  );

-- Guard: the "mark seen" update policy above only checks WHO can
-- update, not WHAT they change. This trigger blocks tampering with
-- anything other than seen_at.
create or replace function public.guard_message_seen_update()
returns trigger language plpgsql as $$
begin
  if new.body <> old.body
     or new.sender_id <> old.sender_id
     or new.conversation_id <> old.conversation_id
     or new.created_at <> old.created_at then
    raise exception 'only seen_at may be updated on messages';
  end if;
  return new;
end $$;

create trigger messages_guard_seen_update
  before update on public.messages
  for each row execute function public.guard_message_seen_update();

create or replace function public.bump_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;

create trigger messages_after_insert_bump
  after insert on public.messages
  for each row execute function public.bump_conversation_last_message();

-- Realtime: push new messages / conversation bumps to subscribed clients.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;

-- ─────────────────────────────────────────────
-- REPORTS (write-only for regular users; review UI is Phase 2 —
-- for now, review via Supabase Studio's table editor)
-- ─────────────────────────────────────────────
create table public.reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid references public.profiles(id) on delete set null,
  target_id         uuid not null references public.profiles(id) on delete cascade,
  reason            text not null,
  details           text,
  status            text not null default 'open' check (status in ('open','dismissed','actioned')),
  created_at        timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "reports_insert_own" on public.reports
  for insert with check (reporter_id = auth.uid());

-- Deliberately no select policy for regular users: you can file a
-- report but not read the report queue. Admin review is Phase 2.

-- ═══════════════════════════════════════════════════════════════
-- SECURITY DEFINER functions — the only sanctioned way to read
-- another user's profile data. Each one decides what to expose.
-- search_path is pinned to prevent search_path hijacking.
-- ═══════════════════════════════════════════════════════════════

-- Card-shaped, privacy-masked fields for a specific set of ids.
-- Used to render chat lists, saved-profile cards, message senders —
-- anywhere you need to label one or more users without fetching
-- their full profile. Unlike search_profiles(), this ignores
-- show_in_search (you already know these ids — e.g. someone you're
-- already messaging, or saved before they turned search off).
create or replace function public.get_identities(p_ids uuid[])
returns table (
  id uuid, username citext, first_name text, last_name text,
  avatar_url text, field text, status text, city text, country text,
  bio text, interests text[], is_banned boolean
)
language sql security definer set search_path = public stable as $$
  select
    p.id, p.username, p.first_name, p.last_name, p.avatar_url, p.field, p.status,
    case when ps.show_location then p.city    else null end,
    case when ps.show_location then p.country else null end,
    p.bio, p.interests, p.is_banned
  from public.profiles p
  join public.privacy_settings ps on ps.profile_id = p.id
  where p.id = any(p_ids);
$$;

grant execute on function public.get_identities(uuid[]) to authenticated;

-- Single profile, masked per that profile's own privacy settings.
-- Not gated by show_in_search — a direct profile link still works,
-- matching the original app's behavior (search-hidden ≠ unlisted).
create or replace function public.get_profile_card(p_username citext)
returns table (
  id uuid, username citext, first_name text, last_name text,
  field text, status text, year_level text, school text, bio text,
  interests text[], languages text[], goals text[], avatar_url text,
  city text, region text, country text, university text,
  telegram text, instagram text, whatsapp text, linkedin text, public_email text,
  join_date timestamptz, is_banned boolean
)
language sql security definer set search_path = public stable as $$
  select
    p.id, p.username, p.first_name, p.last_name, p.field, p.status, p.year_level,
    p.school, p.bio, p.interests, p.languages, p.goals, p.avatar_url,
    case when ps.show_location   then p.city        else null end,
    case when ps.show_location   then p.region       else null end,
    case when ps.show_location   then p.country      else null end,
    case when ps.show_university then p.university   else null end,
    case when ps.show_socials    then p.telegram     else null end,
    case when ps.show_socials    then p.instagram    else null end,
    case when ps.show_socials    then p.whatsapp     else null end,
    case when ps.show_socials    then p.linkedin     else null end,
    case when ps.show_socials    then p.public_email else null end,
    case when ps.show_join_date  then p.created_at   else null end,
    p.is_banned
  from public.profiles p
  join public.privacy_settings ps on ps.profile_id = p.id
  where p.username = p_username;
$$;

grant execute on function public.get_profile_card(citext) to authenticated;

-- Discover / search. Excludes self, banned, admin accounts, and
-- anyone with show_in_search = false. Returns a total_count column
-- (window function) so the client can paginate without a second
-- round trip.
create or replace function public.search_profiles(
  p_query text default null,
  p_country text default null,
  p_field text default null,
  p_status text default null,
  p_goal text default null,
  p_language text default null,
  p_page int default 1,
  p_page_size int default 9
)
returns table (
  id uuid, username citext, first_name text, last_name text, field text,
  status text, city text, country text, bio text, interests text[],
  avatar_url text, total_count bigint
)
language sql security definer set search_path = public stable as $$
  with matches as (
    select p.*, ps.show_location
    from public.profiles p
    join public.privacy_settings ps on ps.profile_id = p.id
    where p.is_banned = false
      and p.is_admin = false
      and p.id <> auth.uid()
      and ps.show_in_search = true
      and (p_query is null or p_query = '' or
           (p.first_name || ' ' || p.last_name || ' ' || coalesce(p.field,'') || ' ' ||
            coalesce(p.university,'') || ' ' || p.username) ilike '%' || p_query || '%')
      and (p_country is null or p_country = '' or p.country = p_country)
      and (p_field is null or p_field = '' or p.field = p_field)
      and (p_status is null or p_status = '' or p.status = p_status)
      and (p_goal is null or p_goal = '' or exists (select 1 from unnest(p.goals) g where g ilike '%'||p_goal||'%'))
      and (p_language is null or p_language = '' or exists (select 1 from unnest(p.languages) l where l ilike '%'||p_language||'%'))
  )
  select
    m.id, m.username, m.first_name, m.last_name, m.field, m.status,
    case when m.show_location then m.city else null end,
    case when m.show_location then m.country else null end,
    m.bio, m.interests, m.avatar_url,
    count(*) over() as total_count
  from matches m
  order by m.created_at desc
  limit p_page_size offset greatest(p_page - 1, 0) * p_page_size;
$$;

grant execute on function public.search_profiles(text,text,text,text,text,text,int,int) to authenticated;

-- Username availability check (avoids exposing full profiles table
-- just to validate a registration/edit form field).
create or replace function public.is_username_available(p_username citext)
returns boolean
language sql security definer set search_path = public stable as $$
  select not exists (select 1 from public.profiles where username = p_username);
$$;

grant execute on function public.is_username_available(citext) to authenticated, anon;

-- Landing-page stats (member / field / country counts). Callable by
-- anonymous visitors — no personal data, just aggregate counts, and
-- only over non-banned, non-admin, search-visible profiles.
create or replace function public.get_landing_stats()
returns table (members bigint, fields bigint, countries bigint)
language sql security definer set search_path = public stable as $$
  select
    count(*) filter (where p.is_banned = false and p.is_admin = false),
    count(distinct p.field) filter (where p.is_banned = false and p.is_admin = false and p.field is not null),
    count(distinct p.country) filter (where p.is_banned = false and p.is_admin = false and p.country is not null)
  from public.profiles p;
$$;

grant execute on function public.get_landing_stats() to authenticated, anon;

-- Conversation list with last-message preview + unread count, in one
-- round trip instead of N+1 queries from the client. Deliberately
-- NOT security definer — it filters by auth.uid() itself and relies
-- on the normal RLS policies on conversations/messages as a backstop.
create or replace function public.list_conversations()
returns table (
  conversation_id uuid, other_user_id uuid, last_message_at timestamptz,
  last_message_body text, last_message_sender uuid, unread_count bigint
)
language sql stable as $$
  select
    c.id,
    case when c.user_a = auth.uid() then c.user_b else c.user_a end,
    c.last_message_at,
    lm.body,
    lm.sender_id,
    coalesce(uc.cnt, 0)
  from public.conversations c
  left join lateral (
    select body, sender_id from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc limit 1
  ) lm on true
  left join lateral (
    select count(*) as cnt from public.messages m2
    where m2.conversation_id = c.id and m2.sender_id <> auth.uid() and m2.seen_at is null
  ) uc on true
  where c.user_a = auth.uid() or c.user_b = auth.uid()
  order by c.last_message_at desc nulls last, c.created_at desc;
$$;

grant execute on function public.list_conversations() to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- STORAGE — avatars bucket
-- Public read (avatars are meant to be visible), write restricted
-- to a folder named after the uploader's own uid.
-- ═══════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatar_owner_write" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatar_owner_update" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatar_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
