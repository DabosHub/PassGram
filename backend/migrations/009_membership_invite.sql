-- Invite created after a confirmed payment when the subscriber is outside the channel.
alter table community_membership_payments
    add column if not exists invite_link text;
