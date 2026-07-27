-- Execute este arquivo no SQL Editor do Supabase.
-- Ele pode ser executado novamente para migrar a primeira versão sem login.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  roles text[] not null default '{}',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, roles, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(
      array(select jsonb_array_elements_text(new.raw_user_meta_data -> 'roles')),
      '{}'::text[]
    ),
    not exists (select 1 from public.profiles)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

drop policy if exists "perfis podem ser visualizados" on public.profiles;
create policy "perfis podem ser visualizados"
on public.profiles for select to authenticated using (true);

drop policy if exists "usuario edita o proprio perfil" on public.profiles;
revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;

create table if not exists public.live_rooms (
  code text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.live_rooms enable row level security;

drop policy if exists "salas podem ser visualizadas" on public.live_rooms;
drop policy if exists "salas podem ser criadas" on public.live_rooms;
drop policy if exists "salas podem ser atualizadas" on public.live_rooms;
drop policy if exists "usuarios autenticados visualizam salas" on public.live_rooms;
drop policy if exists "administrador cria salas" on public.live_rooms;
drop policy if exists "controladores atualizam salas" on public.live_rooms;
drop policy if exists "administrador exclui salas" on public.live_rooms;

create policy "usuarios autenticados visualizam salas"
on public.live_rooms
for select
to authenticated
using (true);

create policy "administrador cria salas"
on public.live_rooms
for insert
to authenticated
with check (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin)
);

create policy "controladores atualizam salas"
on public.live_rooms
for update
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  or exists (
    select 1
    from jsonb_array_elements(state -> 'members') member
    where member ->> 'id' = auth.uid()::text
      and (member ->> 'controller')::boolean = true
  )
)
with check (true);

create policy "administrador exclui salas"
on public.live_rooms
for delete
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin)
  and exists (
    select 1
    from jsonb_array_elements(state -> 'members') member
    where member ->> 'id' = auth.uid()::text
      and (member ->> 'controller')::boolean = true
  )
);

revoke all on public.live_rooms from anon;
grant select, insert, update, delete on public.live_rooms to authenticated;

-- Permite que um usuário autenticado entre pelo código sem receber controle.
create or replace function public.join_room(room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_profile public.profiles%rowtype;
begin
  select * into member_profile
  from public.profiles
  where id = auth.uid();

  if member_profile.id is null then
    raise exception 'Perfil não encontrado';
  end if;

  if not exists (
    select 1 from public.live_rooms lr where lr.code = upper(room_code)
  ) then
    raise exception 'Sala não encontrada';
  end if;

  update public.live_rooms lr
  set state = jsonb_set(
    lr.state,
    '{members}',
    coalesce(lr.state -> 'members', '[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object(
        'id', member_profile.id,
        'name', member_profile.full_name,
        'roles', to_jsonb(member_profile.roles),
        'controller', member_profile.is_admin,
        'online', true
      )),
    true
  ),
  updated_at = now()
  where lr.code = upper(room_code)
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(lr.state -> 'members', '[]'::jsonb)) member
      where member ->> 'id' = auth.uid()::text
    );
end;
$$;

revoke all on function public.join_room(text) from public;
grant execute on function public.join_room(text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.live_rooms;
exception
  when duplicate_object then null;
end $$;
