-- Public shareable community id for subscription deep links.

create sequence if not exists creator_communities_community_id_seq;

alter table creator_communities
  add column if not exists community_id bigint;

update creator_communities
set community_id = nextval('creator_communities_community_id_seq')
where community_id is null;

alter table creator_communities
  alter column community_id set default nextval('creator_communities_community_id_seq');

alter table creator_communities
  alter column community_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'creator_communities_community_id_key'
  ) then
    alter table creator_communities add constraint creator_communities_community_id_key unique (community_id);
  end if;
end $$;

create index if not exists creator_communities_community_id_idx on creator_communities (community_id);
