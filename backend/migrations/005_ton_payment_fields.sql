-- TON / Jetton payment metadata for bot-service indexer.
alter table payments
  add column if not exists invite_link text,
  add column if not exists jetton_master text,
  add column if not exists network text default 'ton';

alter table telegram_wallets
  add column if not exists ton_address text;

create unique index if not exists telegram_wallets_ton_address_uidx
  on telegram_wallets (ton_address)
  where ton_address is not null;

comment on column payments.tx_hash is 'TON transaction hash / BOC id for the confirmed Jetton payment';
comment on column payments.invite_link is 'One-time Telegram invite created after indexer confirmation';
