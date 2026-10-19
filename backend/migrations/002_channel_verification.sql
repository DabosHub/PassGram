-- Apply this to a database that already has backend/schema.sql without the channel tables.

create unique index if not exists communities_telegram_chat_uidx on communities (telegram_chat_id) where telegram_chat_id is not null;

create table if not exists channel_selection_requests (
    request_id integer primary key,
    owner_telegram_user_id bigint not null,
    prepared_button_id text not null,
    status text not null,
    failure_message text,
    telegram_chat_id text,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists channel_selection_owner_idx on channel_selection_requests (owner_telegram_user_id);

create table if not exists creator_communities (
    telegram_chat_id text primary key,
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
    active boolean not null default false,
    created_at timestamptz not null default now(),
    constraint creator_communities_price check (price is null or price ~ '^[1-9][0-9]*$'),
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

create index if not exists creator_communities_owner_idx on creator_communities (owner_telegram_user_id);
