-- One reminder per paid period. A new expires_at_ms qualifies for another last-day message.
alter table community_memberships
    add column if not exists renewal_reminded_for_expires_at_ms bigint;
