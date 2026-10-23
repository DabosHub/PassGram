-- One channel removal per paid period. A later expires_at_ms can be removed again.
alter table community_memberships
    add column if not exists access_removed_for_expires_at_ms bigint;
