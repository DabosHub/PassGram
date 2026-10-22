-- Creator-signed deactivation. The community stays listed for its owner and
-- existing subscribers. Payments, renewals, and new referrals stay closed.
alter table creator_communities
  add column if not exists paused boolean not null default false;
