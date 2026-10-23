-- Cursor for the payment indexer. scan_lt continues a backlog longer than one poll.
create table if not exists indexer_state (
    singleton boolean primary key default true check (singleton),
    last_processed_lt bigint not null default 0,
    scan_lt bigint,
    scan_hash text,
    last_updated_at timestamptz not null default now()
);
