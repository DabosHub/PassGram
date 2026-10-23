-- Apply on a database that already ran 002 through 014.
-- Run this together with the app version that stops writing near_account_id and signer_address.
begin;

-- The live database has the renewal column and is still missing the removal column.
alter table community_memberships
  add column if not exists access_removed_for_expires_at_ms bigint;

-- DB-03. The expiration cron filters confirmed memberships by expiry.
create index if not exists community_memberships_expiry_idx
  on community_memberships (expires_at_ms)
  where confirmation = 'confirmed';

-- DB-05. The check has lived in migration 006 and was missing from a fresh schema.
alter table creator_communities
  drop constraint if exists creator_communities_referral_percent_bps;
alter table creator_communities
  add constraint creator_communities_referral_percent_bps
  check (referral_percent_bps >= 0 and referral_percent_bps <= 5000);

-- DB-04. Amounts are integer USDT base units. Reject blanks and non-digits.
do $$
declare
  item record;
  bad bigint;
begin
  for item in
    select *
    from (values
      ('payments', 'gross_amount', 'payments_gross_amount_digits', false),
      ('payments', 'creator_amount', 'payments_creator_amount_digits', false),
      ('payments', 'treasury_amount', 'payments_treasury_amount_digits', false),
      ('payments', 'referrer_amount', 'payments_referrer_amount_digits', false),
      ('payments', 'community_affiliate_amount', 'payments_community_affiliate_digits', true),
      ('community_memberships', 'payment_amount', 'community_memberships_payment_amount_digits', false),
      ('community_membership_payments', 'gross_amount', 'community_membership_payments_gross_digits', false),
      ('community_membership_payments', 'creator_amount', 'community_membership_payments_creator_digits', false),
      ('community_membership_payments', 'platform_fee', 'community_membership_payments_platform_digits', false),
      ('community_membership_payments', 'affiliate_amount', 'community_membership_payments_affiliate_digits', false),
      ('community_membership_payments', 'community_affiliate_amount', 'community_membership_payments_community_affiliate_digits', false)
    ) as columns(table_name, column_name, constraint_name, nullable)
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = item.table_name
        and column_name = item.column_name
    ) then
      continue;
    end if;
    if item.nullable then
      execute format(
        'select count(*) from %I where %I is not null and %I !~ ''^[0-9]+$''',
        item.table_name, item.column_name, item.column_name
      ) into bad;
    else
      execute format(
        'select count(*) from %I where %I is null or %I !~ ''^[0-9]+$''',
        item.table_name, item.column_name, item.column_name
      ) into bad;
    end if;
    if bad > 0 then
      raise exception '% rows in %.% are not integer base units', bad, item.table_name, item.column_name;
    end if;
    execute format('alter table %I drop constraint if exists %I', item.table_name, item.constraint_name);
    if item.nullable then
      execute format(
        'alter table %I add constraint %I check (%I is null or %I ~ ''^[0-9]+$'')',
        item.table_name, item.constraint_name, item.column_name, item.column_name
      );
    else
      execute format(
        'alter table %I add constraint %I check (%I ~ ''^[0-9]+$'')',
        item.table_name, item.constraint_name, item.column_name
      );
    end if;
  end loop;
end $$;

-- DB-02. Payments and subscriptions use the creator community id, not the legacy communities table.
do $$
declare
  legacy_name text;
begin
  if exists (
    select 1 from payments p
    where not exists (select 1 from creator_communities c where c.community_id = p.community_id)
  ) then
    raise exception 'payments.community_id has rows with no creator_communities match';
  end if;
  if exists (
    select 1 from subscriptions s
    where not exists (select 1 from creator_communities c where c.community_id = s.community_id)
  ) then
    raise exception 'subscriptions.community_id has rows with no creator_communities match';
  end if;
  if exists (
    select 1 from community_attributions a
    where not exists (select 1 from creator_communities c where c.community_id = a.community_id)
  ) then
    raise exception 'community_attributions.community_id has rows with no creator_communities match';
  end if;
  if exists (
    select 1 from community_referral_links l
    where not exists (select 1 from creator_communities c where c.community_id = l.community_id)
  ) then
    raise exception 'community_referral_links.community_id has rows with no creator_communities match';
  end if;

  select con.conname into legacy_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_class ref on ref.oid = con.confrelid
  where rel.relname = 'subscriptions' and con.contype = 'f' and ref.relname = 'communities';
  if legacy_name is not null then
    execute format('alter table subscriptions drop constraint %I', legacy_name);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_community_fk') then
    alter table subscriptions
      add constraint subscriptions_community_fk
      foreign key (community_id) references creator_communities (community_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_community_fk') then
    alter table payments
      add constraint payments_community_fk
      foreign key (community_id) references creator_communities (community_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'community_attributions_community_fk') then
    alter table community_attributions
      add constraint community_attributions_community_fk
      foreign key (community_id) references creator_communities (community_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'community_referral_links_community_fk') then
    alter table community_referral_links
      add constraint community_referral_links_community_fk
      foreign key (community_id) references creator_communities (community_id);
  end if;
end $$;

insert into telegram_profiles (telegram_user_id)
select distinct referrer_telegram_user_id
from community_referral_links
on conflict (telegram_user_id) do nothing;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'community_referral_links_referrer_fk') then
    alter table community_referral_links
      add constraint community_referral_links_referrer_fk
      foreign key (referrer_telegram_user_id) references telegram_profiles (telegram_user_id);
  end if;
end $$;

-- Keep one row when the same community code was stored twice, then enforce uniqueness.
delete from community_referral_links as drop_row
using community_referral_links as keeper
where drop_row.community_id = keeper.community_id
  and drop_row.referrer_code = keeper.referrer_code
  and drop_row.referrer_telegram_user_id <> keeper.referrer_telegram_user_id
  and (
    drop_row.created_at > keeper.created_at
    or (
      drop_row.created_at = keeper.created_at
      and drop_row.referrer_telegram_user_id > keeper.referrer_telegram_user_id
    )
  );

create unique index if not exists community_referral_links_code_idx
  on community_referral_links (community_id, referrer_code);

alter table community_referral_links
  add column if not exists payout_account text;

update community_referral_links as links
set payout_account = affiliates.payout_account
from affiliates
where links.payout_account is null
  and affiliates.payout_account is not null
  and links.referrer_code = affiliates.code;

-- DB-06. Copy any address that was stored only in the old column, then remove it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'telegram_wallets'
      and column_name = 'near_account_id'
  ) then
    update telegram_wallets
    set ton_address = near_account_id
    where ton_address is null
      and near_account_id is not null;
    alter table telegram_wallets drop column near_account_id;
  end if;
  if exists (
    select 1 from telegram_wallets where ton_address is null or btrim(ton_address) = ''
  ) then
    raise exception 'telegram_wallets.ton_address is still empty';
  end if;
end $$;

-- DB-07. The signing wallet is the payout wallet. The extra column is unused.
alter table affiliates drop column if exists signer_address;

-- DB-08. Owner connections used by the app bypass row security.
-- A leaked Supabase anon key cannot read Telegram profiles or payments.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'creators', 'communities', 'referrals', 'subscriptions', 'telegram_wallets', 'payments',
    'channel_selection_requests', 'creator_communities', 'affiliates', 'referral_attributions',
    'telegram_profiles', 'community_memberships', 'community_membership_payments',
    'community_attributions', 'community_referral_links', 'indexer_state'
  ]
  loop
    if exists (
      select 1 from information_schema.tables as live_table
      where live_table.table_schema = 'public' and live_table.table_name = relation_name
    ) then
      execute format('alter table %I enable row level security', relation_name);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;

commit;
