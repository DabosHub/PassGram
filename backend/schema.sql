-- Indexer projection of PassGram contract events.
-- Amounts are USDT base units (6 decimals), stored as text to keep u128 precision.

create table creators (
    account_id text primary key,
    payout_account text not null,
    referrer_account_id text,
    registered_at_ms bigint not null
);

create table communities (
    id bigint primary key,
    owner_account_id text not null references creators (account_id),
    name text not null,
    price text not null,
    period_seconds bigint not null,
    telegram_chat_id text,
    chat_verified boolean not null default false,
    active boolean not null,
    created_at_ms bigint not null
);

create table referrals (
    code text primary key,
    referrer_account_id text not null unique
);

create table subscriptions (
    community_id bigint not null,
    subscriber_account_id text not null,
    expires_at_ms bigint not null,
    last_payment_id bigint not null,
    primary key (community_id, subscriber_account_id)
);

create table telegram_wallets (
    telegram_user_id bigint primary key,
    ton_address text not null,
    linked_at timestamptz not null default now()
);

create unique index telegram_wallets_ton_address_uidx on telegram_wallets (ton_address);

create table payments (
    payment_id bigint primary key,
    community_id bigint not null,
    subscriber_account_id text not null,
    creator_account_id text not null,
    payout_account text not null,
    gross_amount text not null,
    creator_amount text not null,
    treasury_amount text not null,
    referrer_account_id text,
    referrer_amount text not null,
    community_affiliate_amount text,
    community_referrer_account_id text,
    paid_at_ms bigint not null,
    expires_at_ms bigint not null,
    tx_hash text not null,
    invite_link text,
    jetton_master text,
    network text default 'ton',
    constraint payments_tx_hash_uq unique (tx_hash),
    constraint payments_gross_amount_digits check (gross_amount ~ '^[0-9]+$'),
    constraint payments_creator_amount_digits check (creator_amount ~ '^[0-9]+$'),
    constraint payments_treasury_amount_digits check (treasury_amount ~ '^[0-9]+$'),
    constraint payments_referrer_amount_digits check (referrer_amount ~ '^[0-9]+$'),
    constraint payments_community_affiliate_digits check (
        community_affiliate_amount is null or community_affiliate_amount ~ '^[0-9]+$'
    )
);

create sequence payments_payment_id_seq owned by payments.payment_id;
alter table payments alter column payment_id set default nextval('payments_payment_id_seq');

create index subscriptions_expiry_idx on subscriptions (expires_at_ms);

-- One Telegram channel can belong to one PassGram community.
create unique index communities_telegram_chat_uidx on communities (telegram_chat_id) where telegram_chat_id is not null;

-- Channel verification is independent of the on-chain USDT community id.
-- price is an integer USDT amount in 6-decimal base units. duration_days is added to each
-- subscriber's confirmed payment time, not to created_at.
-- telegram_member_count is Telegram's member total, not the paid subscriber count.
create table channel_selection_requests (
    request_id integer primary key,
    owner_telegram_user_id bigint not null,
    prepared_button_id text not null,
    status text not null,
    failure_message text,
    telegram_chat_id text,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index channel_selection_owner_idx on channel_selection_requests (owner_telegram_user_id);

create sequence if not exists creator_communities_community_id_seq;

create table creator_communities (
    telegram_chat_id text primary key,
    community_id bigint not null unique default nextval('creator_communities_community_id_seq'),
    owner_telegram_user_id bigint not null,
    title text not null,
    description text,
    photo_file_id text,
    telegram_member_count integer,
    telegram_member_count_fetched_at timestamptz,
    bot_can_invite_users boolean not null,
    bot_can_restrict_members boolean not null,
    verification_status text not null,
    verified_at timestamptz,
    payout_account text,
    price text,
    duration_days integer,
    referrer_code text,
    referrer_telegram_user_id bigint,
    referral_enabled boolean not null default false,
    referral_percent_bps integer not null default 0,
    active boolean not null default false,
    paused boolean not null default false,
    created_at timestamptz not null default now(),
    constraint creator_communities_price check (price is null or price ~ '^[1-9][0-9]*$'),
    constraint creator_communities_referral_percent_bps check (referral_percent_bps >= 0 and referral_percent_bps <= 5000),
    constraint creator_communities_duration_days check (duration_days is null or (duration_days >= 1 and duration_days <= 366)),
    constraint creator_communities_active_ready check (
        not active
        or (
            verification_status = 'verified'
            and payout_account is not null
            and price is not null
            and duration_days is not null
            and bot_can_invite_users
            and bot_can_restrict_members
        )
    )
);

create index creator_communities_owner_idx on creator_communities (owner_telegram_user_id);
create index creator_communities_community_id_idx on creator_communities (community_id);

alter table subscriptions
    add constraint subscriptions_community_fk
    foreign key (community_id) references creator_communities (community_id);

alter table payments
    add constraint payments_community_fk
    foreign key (community_id) references creator_communities (community_id);

-- Affiliates and first-touch referral attribution (Telegram-keyed, not wallet-keyed).
-- Attribution locks when the invitee presses Start on the bot / opens the invite.
create table affiliates (
    code text primary key,
    telegram_user_id bigint not null unique,
    payout_account text not null,
    created_at timestamptz not null default now(),
    constraint affiliates_code_format check (code ~ '^[a-z0-9_-]{4,32}$')
);

create table referral_attributions (
    telegram_user_id bigint primary key,
    referrer_code text not null references affiliates (code),
    referrer_telegram_user_id bigint not null,
    source text not null,
    locked_at timestamptz not null default now(),
    constraint referral_attributions_source check (source in ('start_webhook', 'mini_app')),
    constraint referral_attributions_not_self check (telegram_user_id <> referrer_telegram_user_id)
);

create index referral_attributions_referrer_idx on referral_attributions (referrer_telegram_user_id);

-- Telegram identity for people who open the Mini App, plus one current membership
-- per community and one row per confirmed subscribe or renewal.
create table telegram_profiles (
    telegram_user_id bigint primary key,
    display_name text not null default '',
    username text not null default '',
    photo_url text not null default '',
    updated_at timestamptz not null default now()
);

create table community_memberships (
    community_id bigint not null references creator_communities (community_id),
    subscriber_telegram_user_id bigint not null references telegram_profiles (telegram_user_id),
    confirmation text not null default 'confirmed',
    started_at_ms bigint,
    expires_at_ms bigint,
    payment_amount text not null default '0',
    renewal_pending boolean not null default false,
    renewal_reminded_for_expires_at_ms bigint,
    access_removed_for_expires_at_ms bigint,
    created_at_ms bigint not null,
    primary key (community_id, subscriber_telegram_user_id),
    constraint community_memberships_confirmation check (confirmation in ('unconfirmed', 'confirmed')),
    constraint community_memberships_payment_amount_digits check (payment_amount ~ '^[0-9]+$')
);

create table community_membership_payments (
    payment_id bigint generated by default as identity primary key,
    community_id bigint not null,
    subscriber_telegram_user_id bigint not null,
    gross_amount text not null,
    creator_amount text not null,
    platform_fee text not null default '0',
    affiliate_amount text not null default '0',
    community_affiliate_amount text not null default '0',
    status text not null,
    transaction_reference text,
    invite_link text,
    paid_at_ms bigint not null,
    unique (transaction_reference),
    foreign key (community_id, subscriber_telegram_user_id)
        references community_memberships (community_id, subscriber_telegram_user_id),
    constraint community_membership_payments_status check (status in ('unconfirmed', 'confirmed', 'failed')),
    constraint community_membership_payments_gross_digits check (gross_amount ~ '^[0-9]+$'),
    constraint community_membership_payments_creator_digits check (creator_amount ~ '^[0-9]+$'),
    constraint community_membership_payments_platform_digits check (platform_fee ~ '^[0-9]+$'),
    constraint community_membership_payments_affiliate_digits check (affiliate_amount ~ '^[0-9]+$'),
    constraint community_membership_payments_community_affiliate_digits check (community_affiliate_amount ~ '^[0-9]+$')
);

create table if not exists community_attributions (
    community_id bigint not null,
    subscriber_telegram_user_id bigint not null,
    referrer_code text not null,
    referrer_telegram_user_id bigint not null,
    locked_at timestamptz not null default now(),
    referral_percent_bps integer not null default 0,
    primary key (community_id, subscriber_telegram_user_id),
    foreign key (community_id) references creator_communities (community_id),
    constraint community_attributions_code_format check (referrer_code ~ '^[a-z0-9_-]{4,32}$'),
    constraint community_attributions_referral_percent_bps check (referral_percent_bps >= 0 and referral_percent_bps <= 5000)
);

create index if not exists community_attributions_referrer_idx
  on community_attributions (referrer_telegram_user_id);

-- One community referral link per Telegram user per community.
-- payout_account is written once for that community and is separate from affiliates.payout_account.
create table if not exists community_referral_links (
    community_id bigint not null,
    referrer_telegram_user_id bigint not null,
    referrer_code text not null,
    payout_account text,
    created_at timestamptz not null default now(),
    primary key (community_id, referrer_telegram_user_id),
    foreign key (community_id) references creator_communities (community_id),
    foreign key (referrer_telegram_user_id) references telegram_profiles (telegram_user_id),
    constraint community_referral_links_code_format check (referrer_code ~ '^[a-z0-9_-]{4,32}$')
);

create unique index if not exists community_referral_links_code_idx
  on community_referral_links (community_id, referrer_code);

create index community_memberships_community_idx on community_memberships (community_id);
create index community_memberships_expiry_idx on community_memberships (expires_at_ms)
    where confirmation = 'confirmed';
create index community_membership_payments_community_idx on community_membership_payments (community_id, paid_at_ms);

-- One row. last_processed_lt is the newest logical time fully indexed.
-- scan_lt/scan_hash continue a backlog that is longer than one poll.
create table indexer_state (
    singleton boolean primary key default true check (singleton),
    last_processed_lt bigint not null default 0,
    scan_lt bigint,
    scan_hash text,
    last_updated_at timestamptz not null default now()
);

-- The app connects as the database owner, which bypasses row security.
-- Supabase anon and authenticated keys get no table access.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'creators', 'communities', 'referrals', 'subscriptions', 'telegram_wallets', 'payments',
    'channel_selection_requests', 'creator_communities', 'affiliates', 'referral_attributions',
    'telegram_profiles', 'community_memberships', 'community_membership_payments',
    'community_attributions', 'community_referral_links', 'indexer_state'
  ]
  loop
    execute format('alter table %I enable row level security', table_name);
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
