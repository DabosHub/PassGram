-- Lock the community referral rate on each attribution.
-- Later edits to the community rate do not change rows that already exist.
alter table community_attributions
  add column if not exists referral_percent_bps integer not null default 0;

update community_attributions as attribution
set referral_percent_bps = community.referral_percent_bps
from creator_communities as community
where community.community_id = attribution.community_id
  and attribution.referral_percent_bps = 0
  and community.referral_percent_bps > 0;

alter table community_attributions
  drop constraint if exists community_attributions_referral_percent_bps;
alter table community_attributions
  add constraint community_attributions_referral_percent_bps
    check (referral_percent_bps >= 0 and referral_percent_bps <= 5000);
