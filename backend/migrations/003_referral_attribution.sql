-- Telegram-first referral attribution. Apply after 002_channel_verification.sql.

create table if not exists affiliates (
    code text primary key,
    telegram_user_id bigint not null unique,
    payout_account text not null,
    created_at timestamptz not null default now(),
    constraint affiliates_code_format check (code ~ '^[a-z0-9_-]{4,32}$')
);

create table if not exists referral_attributions (
    telegram_user_id bigint primary key,
    referrer_code text not null references affiliates (code),
    referrer_telegram_user_id bigint not null,
    source text not null,
    locked_at timestamptz not null default now(),
    constraint referral_attributions_source check (source in ('start_webhook', 'mini_app')),
    constraint referral_attributions_not_self check (telegram_user_id <> referrer_telegram_user_id)
);

create index if not exists referral_attributions_referrer_idx on referral_attributions (referrer_telegram_user_id);

alter table creator_communities
    add column if not exists referrer_code text,
    add column if not exists referrer_telegram_user_id bigint;
