-- Community referral payouts are stored on the community link itself.
-- They are not the PassGram affiliate payout, and a later registration does not replace them.
alter table community_referral_links
  add column if not exists payout_account text;

update community_referral_links as links
set payout_account = affiliates.payout_account
from affiliates
where links.payout_account is null
  and links.referrer_code = affiliates.code;

create unique index if not exists community_referral_links_code_idx
  on community_referral_links (community_id, referrer_code);
