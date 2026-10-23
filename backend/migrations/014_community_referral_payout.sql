-- Community referral payouts are stored on the community link itself.
-- They are not the PassGram affiliate payout, and a later registration does not replace them.
alter table community_referral_links
  add column if not exists payout_account text;

update community_referral_links as links
set payout_account = affiliates.payout_account
from affiliates
where links.payout_account is null
  and affiliates.payout_account is not null
  and links.referrer_code = affiliates.code;

delete from community_referral_links as drop_row
using community_referral_links as keeper
where drop_row.community_id = keeper.community_id
  and drop_row.referrer_code = keeper.referrer_code
  and drop_row.referrer_telegram_user_id <> keeper.referrer_telegram_user_id
  and (
    drop_row.created_at > keeper.created_at
    or (
      drop_row.created_at = keeper.created_at
      and drop_row.referrer_telegram_user_id > keeper.referrer_telegram_user_id
    )
  );

create unique index if not exists community_referral_links_code_idx
  on community_referral_links (community_id, referrer_code);
