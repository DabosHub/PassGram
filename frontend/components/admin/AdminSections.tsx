import type { ReactNode } from "react";
import {
  adminPath,
  barPercent,
  bucketLabel,
  channelStateLabel,
  chartWindow,
  communityStatus,
  formatAdminWhen,
  formatCount,
  formatDuration,
  formatPrice,
  formatUsdtGrouped,
  indexerAlert,
  monthChangeLabel,
  personLabel,
  referralLabel,
  removalLabel,
  shortenAddress,
  txUrl,
  type AdminQuery,
  type IndexerHealth,
} from "@/lib/server/adminView";
import type { AdminData, CommunityDetail, Overview, PaymentRow } from "@/lib/server/adminRepository";

const linkClass = "text-[var(--pg-blue)] hover:underline";
const cardClass = "rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)]";

export function AdminSections({
  data,
  query,
  now,
  network,
}: {
  data: AdminData;
  query: AdminQuery;
  now: number;
  network: "mainnet" | "testnet";
}) {
  if (data.section === "overview") return <OverviewPanel overview={data.overview} query={query} now={now} />;
  if (data.section === "communities") return <CommunitiesPanel data={data} query={query} now={now} network={network} />;
  if (data.section === "payments") return <PaymentsPanel data={data} query={query} network={network} />;
  if (data.section === "referrals") return <ReferralsPanel data={data} query={query} />;
  return <OperationsPanel data={data.operations} query={query} now={now} network={network} />;
}

function OverviewPanel({ overview, query, now }: { overview: Overview; query: AdminQuery; now: number }) {
  const alerts = alertItems(overview, query, now);
  const peak = overview.series.reduce((max, point) => (point.treasury > max ? point.treasury : max), 0n);
  const bucketMs = chartWindow(query.period, now).bucketMs;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Payment volume" value={formatUsdtGrouped(overview.gross)} unit="USDT" />
        <Stat label="Payments" value={formatCount(overview.paymentCount)} />
        <Stat label="Your share" value={formatUsdtGrouped(overview.treasury)} unit="USDT" />
        <Stat label="Creator payouts" value={formatUsdtGrouped(overview.creator)} unit="USDT" />
        <Stat label="Platform marketers" value={formatUsdtGrouped(overview.platformAffiliate)} unit="USDT" />
        <Stat
          label="Community marketers"
          value={overview.communityAffiliate == null ? "Not recorded" : formatUsdtGrouped(overview.communityAffiliate)}
          unit={overview.communityAffiliate == null ? undefined : "USDT"}
        />
        <Stat label="Active subscribers" value={formatCount(overview.activeSubscribers)} note="Paid access that has not expired" />
        <section className={`${cardClass} px-4 py-4`}>
          <h2 className="text-[13px] text-[var(--pg-hint)]">Communities</h2>
          <dl className="mt-3 space-y-2 text-[14px]">
            <CountLine label="Listed" value={overview.listed} />
            <CountLine label="Paused" value={overview.paused} />
            <CountLine label="Unverified" value={overview.unverified} />
          </dl>
        </section>
      </div>
      <section className={`${cardClass} px-4 py-4`}>
        <h2 className="text-[15px] text-[var(--pg-text)]">Your share</h2>
        <p className="mt-1 text-[13px] text-[var(--pg-hint)]">{query.period === "all" ? "Last 90 days" : "Selected period"}</p>
        {peak === 0n ? (
          <p className="mt-6 text-[14px] text-[var(--pg-hint)]">No share in this chart.</p>
        ) : (
          <div className="mt-4">
            <div className="flex h-36 items-end gap-1" aria-hidden="true">
              {overview.series.map((point) => (
                <div key={point.startMs} className="flex h-full flex-1 items-end" title={`${bucketLabel(point.startMs, bucketMs)} · ${formatUsdtGrouped(point.treasury)} USDT`}>
                  <div
                    className="w-full rounded-t-[4px] bg-[var(--pg-blue)]"
                    style={{ height: `${Math.max(point.treasury > 0n ? 4 : 0, barPercent(point.treasury, peak))}%` }}
                  />
                </div>
              ))}
            </div>
            <ChartEnds series={overview.series} bucketMs={bucketMs} />
          </div>
        )}
      </section>
      <MmrChart points={overview.mmr} />
      <section className={`${cardClass} px-4 py-4`}>
        <h2 className="text-[15px] text-[var(--pg-text)]">Attention</h2>
        {alerts.length === 0 ? (
          <p className="mt-3 text-[14px] text-[var(--pg-mint)]">Nothing needs attention.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {alerts.map((item) => (
              <li key={item.text}>
                <a href={item.href} className={linkClass}>
                  {item.text}
                </a>
              </li>
            ))}
            <li className="text-[13px] text-[var(--pg-hint)]">These alerts are current. They ignore the period above.</li>
          </ul>
        )}
      </section>
    </div>
  );
}

function MmrChart({ points }: { points: Overview["mmr"] }) {
  const current = points.at(-1);
  const previous = points.at(-2);
  const peak = points.reduce((max, point) => (point.treasury > max ? point.treasury : max), 0n);
  const change = current && previous ? monthChangeLabel(current.treasury, previous.treasury) : null;
  return (
    <section className={`${cardClass} px-4 py-4`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] text-[var(--pg-text)]">MMR</h2>
          <p className="mt-1 text-[13px] text-[var(--pg-hint)]">Your share, totaled by month.</p>
        </div>
        {current && peak > 0n ? (
          <p className="text-right">
            <span className="pg-amount block text-[28px] leading-none">{formatUsdtGrouped(current.treasury)}</span>
            <span className="mt-1 block text-[13px] text-[var(--pg-hint)]">USDT this month</span>
          </p>
        ) : null}
      </div>
      {peak === 0n ? (
        <p className="mt-6 text-[14px] text-[var(--pg-hint)]">No share in the last 12 months.</p>
      ) : (
        <div className="mt-4">
          <p className="text-[13px] text-[var(--pg-hint)]">{change ? `${change}. Last 12 months.` : "Last 12 months."}</p>
          <div className="mt-4 grid grid-cols-12 gap-1" aria-hidden="true">
            {points.map((point, index) => {
              const latest = index === points.length - 1;
              return (
                <div key={point.startMs} className="flex min-w-0 flex-col items-center gap-1" title={`${point.label} · ${formatUsdtGrouped(point.treasury)} USDT`}>
                  <div className="flex h-28 w-full items-end">
                    <div
                      className={`w-full rounded-t-[4px] ${latest ? "bg-[var(--pg-blue)]" : "bg-[var(--pg-input-line)]"}`}
                      style={{ height: `${Math.max(point.treasury > 0n ? 6 : 0, barPercent(point.treasury, peak))}%` }}
                    />
                  </div>
                  <span className={`text-[11px] ${latest ? "text-[var(--pg-text)]" : "text-[var(--pg-hint)]"}`}>{point.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function CommunitiesPanel({
  data,
  query,
  now,
  network,
}: {
  data: Extract<AdminData, { section: "communities" }>;
  query: AdminQuery;
  now: number;
  network: "mainnet" | "testnet";
}) {
  if (data.missingDetail) {
    return <Empty>This community is not in the ledger.</Empty>;
  }
  if (data.detail) return <CommunityDetailView detail={data.detail} query={query} now={now} network={network} />;
  return (
    <div className="space-y-3">
      {data.truncated ? <p className="text-[13px] text-[var(--pg-hint)]">Showing the 200 communities with the largest share in this period.</p> : null}
      <DataTable
        caption="Communities"
        columns={["Community", "Status", "Price", "Duration", "Referral", "Paid subscribers", "Volume", "Your share"]}
        empty={data.communities.length === 0 ? "No communities yet." : null}
      >
        {data.communities.map((row) => (
          <tr key={row.communityId} className="border-b border-[var(--pg-line)] last:border-0">
            <td className="px-4 py-3">
              <a className={linkClass} href={adminPath({ ...query, section: "communities", communityId: row.communityId, page: 1 })}>
                {row.title}
              </a>
              <span className="mt-1 block text-[12px] text-[var(--pg-hint)]">{channelStateLabel(row.verificationStatus)}</span>
            </td>
            <td className="px-4 py-3">{communityStatus(row)}</td>
            <td className="px-4 py-3 text-right">{formatPrice(row.price)}</td>
            <td className="px-4 py-3 text-right">{formatDuration(row.durationDays)}</td>
            <td className="px-4 py-3 text-right">{referralLabel(row.referralEnabled, row.referralBps)}</td>
            <td className="px-4 py-3 text-right">{formatCount(row.paidSubscribers)}</td>
            <td className="px-4 py-3 text-right">{formatUsdtGrouped(row.gross)}</td>
            <td className="px-4 py-3 text-right">{formatUsdtGrouped(row.treasury)}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function CommunityDetailView({
  detail,
  query,
  now,
  network,
}: {
  detail: CommunityDetail;
  query: AdminQuery;
  now: number;
  network: "mainnet" | "testnet";
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Status" value={communityStatus(detail)} note={channelStateLabel(detail.verificationStatus)} />
        <Stat label="Price" value={formatPrice(detail.price)} />
        <Stat label="Duration" value={formatDuration(detail.durationDays)} />
        <Stat label="Referral" value={referralLabel(detail.referralEnabled, detail.referralBps)} />
        <Stat label="Paid subscribers" value={formatCount(detail.paidSubscribers)} note="Active now" />
        <Stat label="Telegram members" value={detail.memberCount == null ? "—" : formatCount(detail.memberCount)} />
        <Stat label="Volume" value={formatUsdtGrouped(detail.gross)} unit="USDT" />
        <Stat label="Your share" value={formatUsdtGrouped(detail.treasury)} unit="USDT" />
      </div>
      {detail.description ? <p className="max-w-3xl text-[15px] break-words whitespace-pre-wrap">{detail.description}</p> : null}
      <p className="text-[14px] text-[var(--pg-hint)]">
        Owner <span className="text-[var(--pg-text)]">{detail.ownerTelegramUserId}</span>
      </p>
      <p className="text-[14px] break-all text-[var(--pg-hint)]">
        Payout <span className="text-[var(--pg-text)]">{detail.payoutAccount || "Not set"}</span>
      </p>
      {!detail.canInvite || !detail.canRestrict ? (
        <p className="text-[14px] text-[var(--pg-ruby)]">{rightsLabel(detail)}</p>
      ) : null}
      <SectionTitle title="Payments" aside="Amounts in USDT" />
      <PaymentTable rows={detail.payments} query={query} network={network} empty="No confirmed payments in this period." />
      <SectionTitle title="Memberships" aside="Current access" />
      <DataTable caption="Memberships" columns={["Person", "Telegram", "Access", "Expires"]} empty={detail.memberships.length === 0 ? "No memberships yet." : null}>
        {detail.memberships.map((row) => {
          const access = removalLabel(row.expiresAtMs, row.removedForExpiresAtMs, now);
          return (
            <tr key={row.telegramUserId} className="border-b border-[var(--pg-line)] last:border-0">
              <td className="px-4 py-3">{personLabel(row.name, row.username)}</td>
              <td className="px-4 py-3">{row.telegramUserId}</td>
              <td className={`px-4 py-3 ${access === "Waiting for removal" ? "text-[var(--pg-ruby)]" : ""}`}>{access}</td>
              <td className="px-4 py-3">{row.expiresAtMs ? formatAdminWhen(row.expiresAtMs) : "—"}</td>
            </tr>
          );
        })}
      </DataTable>
      <SectionTitle title="Marketer links" />
      <DataTable caption="Marketer links" columns={["Code", "Telegram", "Payout"]} empty={detail.links.length === 0 ? "No marketer links yet." : null}>
        {detail.links.map((row) => (
          <tr key={`${row.telegramUserId}-${row.code}`} className="border-b border-[var(--pg-line)] last:border-0">
            <td className="px-4 py-3">{row.code}</td>
            <td className="px-4 py-3">{row.telegramUserId}</td>
            <td className="px-4 py-3" title={row.payoutAccount || undefined}>{row.payoutAccount ? shortenAddress(row.payoutAccount) : "Not set"}</td>
          </tr>
        ))}
      </DataTable>
      <SectionTitle title="Locked attributions" />
      <DataTable caption="Locked attributions" columns={["Subscriber", "Marketer", "Rate", "Locked"]} empty={detail.attributions.length === 0 ? "No subscriber is locked to a marketer." : null}>
        {detail.attributions.map((row) => (
          <tr key={row.subscriberTelegramUserId} className="border-b border-[var(--pg-line)] last:border-0">
            <td className="px-4 py-3">
              {personLabel(row.subscriberName, row.subscriberUsername)}
              <span className="mt-1 block text-[12px] text-[var(--pg-hint)]">{row.subscriberTelegramUserId}</span>
            </td>
            <td className="px-4 py-3">
              {personLabel(row.referrerName, "")}
              <span className="mt-1 block text-[12px] text-[var(--pg-hint)]">{row.code} · {row.referrerTelegramUserId}</span>
            </td>
            <td className="px-4 py-3 text-right">{referralLabel(true, row.bps)}</td>
            <td className="px-4 py-3">{row.lockedAtMs ? formatAdminWhen(row.lockedAtMs) : "—"}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function PaymentsPanel({
  data,
  query,
  network,
}: {
  data: Extract<AdminData, { section: "payments" }>;
  query: AdminQuery;
  network: "mainnet" | "testnet";
}) {
  return (
    <div className="space-y-3">
      {data.missingFilter ? <Empty>This community is not in the ledger.</Empty> : null}
      {data.filterTitle ? (
        <p className="text-[14px] text-[var(--pg-hint)]">
          Showing {data.filterTitle}.{" "}
          <a className={linkClass} href={adminPath({ ...query, communityId: null, page: 1 })}>
            Clear
          </a>
        </p>
      ) : null}
      {data.missingFilter ? null : <p className="text-[13px] text-[var(--pg-hint)]">Amounts in USDT.</p>}
      {data.missingFilter ? null : (
        <PaymentTable rows={data.rows} query={query} network={network} empty="No confirmed payments in this period." />
      )}
      {data.missingFilter ? null : (
        <div className="flex items-center justify-between text-[14px]">
          <span className="text-[var(--pg-hint)]">Page {formatCount(query.page)}</span>
          <span className="flex gap-4">
            {query.page > 1 ? (
              <a className={linkClass} href={adminPath({ ...query, page: query.page - 1 })}>
                Previous
              </a>
            ) : null}
            {data.hasMore ? (
              <a className={linkClass} href={adminPath({ ...query, page: query.page + 1 })}>
                Next
              </a>
            ) : null}
          </span>
        </div>
      )}
    </div>
  );
}

function ReferralsPanel({
  data,
  query,
}: {
  data: Extract<AdminData, { section: "referrals" }>;
  query: AdminQuery;
}) {
  const communityMissing = data.community.some((row) => row.recorded === 0 && row.attributed > 0);
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle title="Platform marketers" aside="Paid on confirmed payments" />
        {data.unassigned ? (
          <p className="text-[14px] text-[var(--pg-text)]">
            {formatCount(data.unassigned.paymentCount)} payments include {formatUsdtGrouped(data.unassigned.paid)} USDT that is not tied to a marketer wallet.
          </p>
        ) : null}
        <DataTable caption="Platform marketers" columns={["Code", "Telegram", "Payout", "People", "Payments", "Paid"]} empty={data.platform.length === 0 ? "No platform marketers yet." : null}>
          {data.platform.map((row) => (
            <tr key={row.code} className="border-b border-[var(--pg-line)] last:border-0">
              <td className="px-4 py-3">{row.code}</td>
              <td className="px-4 py-3">{row.telegramUserId}</td>
              <td className="px-4 py-3" title={row.payoutAccount}>{shortenAddress(row.payoutAccount)}</td>
              <td className="px-4 py-3 text-right">{formatCount(row.attributed)}</td>
              <td className="px-4 py-3 text-right">{formatCount(row.paymentCount)}</td>
              <td className="px-4 py-3 text-right">{formatUsdtGrouped(row.paid)}</td>
            </tr>
          ))}
        </DataTable>
      </section>
      <section className="space-y-3">
        <SectionTitle title="Community marketers" aside={periodHint(query)} />
        {communityMissing ? (
          <p className="text-[13px] text-[var(--pg-hint)]">A payout is shown when the indexer has stored it on the payment.</p>
        ) : null}
        <DataTable caption="Community marketers" columns={["Community", "Code", "Telegram", "Payout", "People", "Paid"]} empty={data.community.length === 0 ? "No community marketers yet." : null}>
          {data.community.map((row) => (
            <tr key={`${row.communityId}-${row.telegramUserId}`} className="border-b border-[var(--pg-line)] last:border-0">
              <td className="px-4 py-3">
                <a className={linkClass} href={adminPath({ ...query, section: "communities", communityId: row.communityId, page: 1 })}>
                  {row.title}
                </a>
              </td>
              <td className="px-4 py-3">{row.code}</td>
              <td className="px-4 py-3">{row.telegramUserId}</td>
              <td className="px-4 py-3" title={row.payoutAccount || undefined}>{row.payoutAccount ? shortenAddress(row.payoutAccount) : "Not set"}</td>
              <td className="px-4 py-3 text-right">{formatCount(row.attributed)}</td>
              <td className="px-4 py-3 text-right">{row.recorded === 0 && row.attributed > 0 ? "Not recorded" : formatUsdtGrouped(row.paid)}</td>
            </tr>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

function OperationsPanel({
  data,
  query,
  now,
  network,
}: {
  data: Extract<AdminData, { section: "operations" }>["operations"];
  query: AdminQuery;
  now: number;
  network: "mainnet" | "testnet";
}) {
  const alert = indexerAlert(data.indexer, now);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <section className={`${cardClass} px-4 py-4 sm:col-span-2`}>
          <h2 className="text-[15px]">Indexer</h2>
          <p className="mt-3 text-[14px]">{indexerSentence(alert, data.indexer)}</p>
          <dl className="mt-4 space-y-2 text-[14px]">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--pg-hint)]">Last write</dt>
              <dd>{data.indexer.updatedAtMs ? formatAdminWhen(data.indexer.updatedAtMs) : "Never"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--pg-hint)]">Position</dt>
              <dd className="break-all text-right">{data.indexer.position}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--pg-hint)]">Backlog</dt>
              <dd>{data.indexer.backlog ? "Still reading earlier transactions" : "Caught up"}</dd>
            </div>
          </dl>
        </section>
        <div className="grid gap-3">
          <Stat label="Linked wallets" value={formatCount(data.wallets)} />
          <Stat label="Profiles" value={formatCount(data.profiles)} />
        </div>
      </div>
      <section className="space-y-3">
        <SectionTitle title="Payments without a membership" aside={formatCount(data.paymentsWithoutMembership)} />
        <DataTable caption="Payments without a membership" columns={["When", "Community", "Gross", "Transaction"]} empty={data.openPayments.length === 0 ? "Every confirmed payment has a membership." : null}>
          {data.openPayments.map((row) => (
            <tr key={row.txHash} className="border-b border-[var(--pg-line)] last:border-0">
              <td className="px-4 py-3 whitespace-nowrap">{formatAdminWhen(row.paidAtMs)}</td>
              <td className="px-4 py-3">
                <a className={linkClass} href={adminPath({ ...query, section: "communities", communityId: row.communityId, page: 1 })}>
                  {row.title}
                </a>
              </td>
              <td className="px-4 py-3 text-right">{formatUsdtGrouped(row.gross)}</td>
              <td className="px-4 py-3"><TxLink hash={row.txHash} network={network} /></td>
            </tr>
          ))}
        </DataTable>
      </section>
      <section className="space-y-3">
        <SectionTitle title="Expired access still inside" aside={formatCount(data.expiredNotRemoved)} />
        <DataTable caption="Expired memberships waiting for removal" columns={["Community", "Person", "Telegram", "Expired"]} empty={data.openRemovals.length === 0 ? "No expired membership is waiting for removal." : null}>
          {data.openRemovals.map((row) => (
            <tr key={`${row.communityId}-${row.telegramUserId}`} className="border-b border-[var(--pg-line)] last:border-0">
              <td className="px-4 py-3">{row.title}</td>
              <td className="px-4 py-3">{personLabel(row.name, row.username)}</td>
              <td className="px-4 py-3">{row.telegramUserId}</td>
              <td className="px-4 py-3 whitespace-nowrap">{formatAdminWhen(row.expiresAtMs)}</td>
            </tr>
          ))}
        </DataTable>
      </section>
      <section className="space-y-3">
        <SectionTitle title="Bot rights" />
        <DataTable caption="Communities missing bot rights" columns={["Community", "Missing right"]} empty={data.botGaps.length === 0 ? "Verified communities can still invite and remove members." : null}>
          {data.botGaps.map((row) => (
            <tr key={row.communityId} className="border-b border-[var(--pg-line)] last:border-0">
              <td className="px-4 py-3">
                <a className={linkClass} href={adminPath({ ...query, section: "communities", communityId: row.communityId, page: 1 })}>
                  {row.title}
                </a>
              </td>
              <td className="px-4 py-3">{rightsLabel(row)}</td>
            </tr>
          ))}
        </DataTable>
      </section>
      <section className="space-y-3">
        <SectionTitle title="Channel selections waiting" />
        <DataTable caption="Stuck channel selections" columns={["Request", "Owner", "Status", "Started"]} empty={data.stuckSelections.length === 0 ? "No channel selection is waiting." : null}>
          {data.stuckSelections.map((row) => (
            <tr key={row.requestId} className="border-b border-[var(--pg-line)] last:border-0">
              <td className="px-4 py-3">{row.requestId}</td>
              <td className="px-4 py-3">{row.ownerTelegramUserId}</td>
              <td className="px-4 py-3">{channelStateLabel(row.status)}</td>
              <td className="px-4 py-3 whitespace-nowrap">{row.createdAtMs ? formatAdminWhen(row.createdAtMs) : "—"}</td>
            </tr>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

function PaymentTable({
  rows,
  query,
  network,
  empty,
}: {
  rows: PaymentRow[];
  query: AdminQuery;
  network: "mainnet" | "testnet";
  empty: string | null;
}) {
  return (
    <DataTable caption="Payments" columns={["When", "Community", "Gross", "Creator", "Your share", "Platform", "Marketer", "Transaction"]} empty={empty != null && rows.length === 0 ? empty : null}>
      {rows.map((row) => (
        <tr key={row.txHash} className="border-b border-[var(--pg-line)] last:border-0">
          <td className="px-4 py-3 whitespace-nowrap">{formatAdminWhen(row.paidAtMs)}</td>
          <td className="px-4 py-3">
            <a className={linkClass} href={adminPath({ ...query, section: "communities", communityId: row.communityId, page: 1 })}>
              {row.title}
            </a>
          </td>
          <td className="px-4 py-3 text-right">{formatUsdtGrouped(row.gross)}</td>
          <td className="px-4 py-3 text-right">{formatUsdtGrouped(row.creator)}</td>
          <td className="px-4 py-3 text-right">{formatUsdtGrouped(row.treasury)}</td>
          <td className="px-4 py-3 text-right">{formatUsdtGrouped(row.platformAffiliate)}</td>
          <td className="px-4 py-3 text-right">{row.communityAffiliate == null ? "—" : formatUsdtGrouped(row.communityAffiliate)}</td>
          <td className="px-4 py-3"><TxLink hash={row.txHash} network={network} /></td>
        </tr>
      ))}
    </DataTable>
  );
}

function alertItems(overview: Overview, query: AdminQuery, now: number): { href: string; text: string }[] {
  const href = adminPath({ ...query, section: "operations", communityId: null, page: 1 });
  const items: { href: string; text: string }[] = [];
  if (overview.paymentsWithoutMembership > 0) {
    const countLabel = formatCount(overview.paymentsWithoutMembership);
    items.push({
      href,
      text: overview.paymentsWithoutMembership === 1 ? "1 confirmed payment has no membership." : `${countLabel} confirmed payments have no membership.`,
    });
  }
  if (overview.expiredNotRemoved > 0) {
    const countLabel = formatCount(overview.expiredNotRemoved);
    items.push({
      href,
      text: overview.expiredNotRemoved === 1 ? "1 expired membership is still waiting for removal." : `${countLabel} expired memberships are still waiting for removal.`,
    });
  }
  const alert = indexerAlert(overview.indexer, now);
  if (alert) items.push({ href, text: indexerSentence(alert, overview.indexer) });
  return items;
}

function indexerSentence(alert: ReturnType<typeof indexerAlert>, health: IndexerHealth): string {
  if (alert === "missing" || !health.updatedAtMs) return "Indexer has no saved position.";
  if (alert === "backlog") return `Indexer backlog has not moved since ${formatAdminWhen(health.updatedAtMs)}.`;
  if (alert === "quiet") return `Indexer has not written since ${formatAdminWhen(health.updatedAtMs)}.`;
  return health.backlog ? "Indexer is reading earlier transactions." : "Indexer is caught up.";
}

function rightsLabel(row: { canInvite: boolean; canRestrict: boolean }): string {
  if (!row.canInvite && !row.canRestrict) return "Cannot invite or remove members";
  if (!row.canInvite) return "Cannot invite";
  return "Cannot remove members";
}

function periodHint(query: AdminQuery): string {
  if (query.period === "24h") return "Past 24 hours";
  if (query.period === "7d") return "Past 7 days";
  if (query.period === "30d") return "Past 30 days";
  return "All time";
}

function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <section className={`${cardClass} px-4 py-4`}>
      <h2 className="text-[13px] text-[var(--pg-hint)]">{label}</h2>
      <p className="pg-amount mt-2 text-[28px] leading-none break-words">{value}</p>
      {unit ? <p className="mt-2 text-[13px] text-[var(--pg-hint)]">{unit}</p> : null}
      {note ? <p className="mt-2 text-[13px] text-[var(--pg-hint)]">{note}</p> : null}
    </section>
  );
}

function CountLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[var(--pg-hint)]">{label}</dt>
      <dd className="pg-amount text-[20px]">{formatCount(value)}</dd>
    </div>
  );
}

function SectionTitle({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-[18px]">{title}</h2>
      {aside ? <p className="text-[13px] text-[var(--pg-hint)]">{aside}</p> : null}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={`${cardClass} px-4 py-6 text-[14px] text-[var(--pg-hint)]`}>{children}</p>;
}

function DataTable({
  caption,
  columns,
  empty,
  children,
}: {
  caption: string;
  columns: string[];
  empty: string | null;
  children: ReactNode;
}) {
  return (
    <div className={`${cardClass} overflow-x-auto`}>
      <table className="w-full min-w-[760px] border-collapse text-left text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--pg-line)] text-[13px] text-[var(--pg-hint)]">
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3 font-normal">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td className="px-4 py-6 text-[var(--pg-hint)]" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

function ChartEnds({ series, bucketMs }: { series: { startMs: number }[]; bucketMs: number }) {
  const first = series[0];
  const last = series[series.length - 1];
  return (
    <div className="mt-2 flex justify-between text-[12px] text-[var(--pg-hint)]">
      <span>{first ? bucketLabel(first.startMs, bucketMs) : ""}</span>
      <span>{last ? bucketLabel(last.startMs, bucketMs) : ""}</span>
    </div>
  );
}

function TxLink({ hash, network }: { hash: string; network: "mainnet" | "testnet" }) {
  const url = txUrl(hash, network);
  const label = shortenAddress(hash);
  if (!url) return <span title={hash}>{label}</span>;
  return (
    <a className={linkClass} href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
