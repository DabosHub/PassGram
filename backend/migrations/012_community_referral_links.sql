-- One referral link per marketer per community. The creator is notified on the first insert.
create table if not exists community_referral_links (
    community_id bigint not null,
    referrer_telegram_user_id bigint not null,
    referrer_code text not null,
    created_at timestamptz not null default now(),
    primary key (community_id, referrer_telegram_user_id),
    constraint community_referral_links_code_format check (referrer_code ~ '^[a-z0-9_-]{4,32}$')
);
