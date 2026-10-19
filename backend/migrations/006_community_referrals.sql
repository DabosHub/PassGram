-- Community-level referral program (cut from creator share).
alter table creator_communities
  add column if not exists referral_enabled boolean not null default false,
  add column if not exists referral_percent_bps integer not null default 0;

alter table creator_communities
  drop constraint if exists creator_communities_referral_percent_bps;
alter table creator_communities
  add constraint creator_communities_referral_percent_bps
  check (referral_percent_bps >= 0 and referral_percent_bps <= 5000);

-- First-touch attribution: subscriber → community promoter (scoped per community).
create table if not exists community_attributions (
  community_id bigint not null,
  subscriber_telegram_user_id bigint not null,
  referrer_code text not null,
  referrer_telegram_user_id bigint not null,
  locked_at timestamptz not null default now(),
  primary key (community_id, subscriber_telegram_user_id),
  constraint community_attributions_code_format check (referrer_code ~ '^[a-z0-9_-]{4,32}$')
);

create index if not exists community_attributions_referrer_idx
  on community_attributions (referrer_telegram_user_id);

alter table payments
  add column if not exists community_affiliate_amount text,
  add column if not exists community_referrer_account_id text;
