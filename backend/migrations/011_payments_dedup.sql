-- One payment row per chain transaction. payment_id comes from a sequence so two
-- indexers cannot take the same id with max(payment_id)+1.

update subscriptions s
set last_payment_id = keeper.payment_id
from payments drop_row
join payments keeper
  on keeper.tx_hash = drop_row.tx_hash
 and keeper.payment_id < drop_row.payment_id
where drop_row.tx_hash is not null
  and btrim(drop_row.tx_hash) <> ''
  and s.last_payment_id = drop_row.payment_id;

delete from payments drop_row
using payments keeper
where drop_row.tx_hash is not null
  and btrim(drop_row.tx_hash) <> ''
  and drop_row.tx_hash = keeper.tx_hash
  and drop_row.payment_id > keeper.payment_id;

update payments
set tx_hash = 'legacy:' || payment_id::text
where tx_hash is null or btrim(tx_hash) = '';

alter table payments alter column tx_hash set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'payments'::regclass and conname = 'payments_tx_hash_uq'
  ) then
    alter table payments add constraint payments_tx_hash_uq unique (tx_hash);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'payments'::regclass and contype = 'p'
  ) then
    alter table payments add constraint payments_payment_id_pk primary key (payment_id);
  end if;
end $$;

create sequence if not exists payments_payment_id_seq;

do $$
declare
  next_id bigint;
  upcoming bigint;
  seq_called boolean;
begin
  select coalesce(max(payment_id), 0) + 1 into next_id from payments;
  select last_value, is_called into upcoming, seq_called from payments_payment_id_seq;
  if seq_called then
    upcoming := upcoming + 1;
  end if;
  if next_id > upcoming then
    perform setval('payments_payment_id_seq', next_id, false);
  end if;
end $$;

alter table payments alter column payment_id set default nextval('payments_payment_id_seq');
alter sequence payments_payment_id_seq owned by payments.payment_id;
