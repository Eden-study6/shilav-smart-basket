'use client';

import { useState } from 'react';
import {
  Baby,
  Check,
  Clock,
  Flame,
  MessageCircle,
  Package,
  Pencil,
  Send,
  ShieldCheck,
  Snowflake,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import type {
  Campaign,
  CampaignCopy,
  CampaignStream,
  CampaignType,
  CustomerProfile,
} from '@/lib/types';
import { buildReviewSummary, renderCampaignMessage } from '@/lib/campaignEngine';
import { WhatsAppPreview } from '@/components/WhatsAppPreview';
import { cn, formatPrice } from '@/lib/utils';

interface AdminDashboardProps {
  campaigns: Campaign[];
  customers: CustomerProfile[];
  onApprove: (campaignId: string) => void;
  onReject: (campaignId: string, reason: string) => void;
  onEdit: (campaignId: string, changes: Partial<CampaignCopy>) => void;
  onSend: (campaignId: string) => void;
  /** Result of the last action, echoed back from the review API. */
  notice: { text: string; ok: boolean } | null;
  /** Identifier recorded in the audit trail for every decision. */
  reviewer: string;
  /** Reference date, injected so message previews stay deterministic. */
  now: Date;
}

const STATUS_STYLES: Record<Campaign['status'], { label: string; className: string }> = {
  pending_approval: { label: 'ממתין לאישור', className: 'bg-cream-300 text-ink' },
  approved: { label: 'אושר', className: 'bg-sage-200 text-sage-600' },
  rejected: { label: 'נדחה', className: 'bg-blush-200 text-ink-muted' },
  sent: { label: 'נשלח', className: 'bg-sky-baby-200 text-ink' },
};

const SEVERITY_STYLES: Record<Campaign['severity'], string> = {
  high: 'bg-terracotta-400 text-cream-50',
  medium: 'bg-terracotta-200 text-terracotta-600',
  low: 'bg-cream-300 text-ink-muted',
};

const SEVERITY_LABELS: Record<Campaign['severity'], string> = {
  high: 'דחיפות גבוהה',
  medium: 'דחיפות בינונית',
  low: 'דחיפות נמוכה',
};

const TYPE_META: Record<CampaignType, { label: string; icon: typeof Baby }> = {
  growth_milestone: { label: 'צומת גדילה', icon: Baby },
  season_shift: { label: 'החלפת עונה', icon: TrendingUp },
  replenishment: { label: 'חידוש קשר', icon: Clock },
  cold_snap: { label: 'גל קור מקומי', icon: Snowflake },
  heatwave: { label: 'גל חום', icon: Flame },
  surplus_stock: { label: 'עודף מלאי', icon: TrendingDown },
};

const STREAM_TABS: Array<{ stream: CampaignStream; title: string; subtitle: string }> = [
  {
    stream: 'lifecycle',
    title: 'קמפיינים שוטפים',
    subtitle: 'צמתי גדילה ועונות',
  },
  {
    stream: 'anomaly',
    title: 'אירועים חריגים',
    subtitle: 'מזג אוויר ומלאי',
  },
];

/**
 * Marketing console. Nothing here dispatches on its own: every campaign arrives
 * as a proposal and needs an explicit human decision, in order — edit, approve,
 * then send.
 *
 * The two streams are separated on purpose. Lifecycle campaigns are the primary
 * business case and open by default; reactive weather and stock alerts live in
 * their own tab so they cannot crowd the routine work out of view.
 */
export function AdminDashboard({
  campaigns,
  customers,
  onApprove,
  onReject,
  onEdit,
  onSend,
  notice,
  reviewer,
  now,
}: AdminDashboardProps) {
  const [activeStream, setActiveStream] = useState<CampaignStream>('lifecycle');
  const [previewCampaignId, setPreviewCampaignId] = useState<string | null>(null);

  const visible = campaigns.filter((campaign) => campaign.stream === activeStream);
  const pendingAll = campaigns.filter(
    (campaign) => campaign.status === 'pending_approval',
  );
  const previewCampaign = campaigns.find(
    (campaign) => campaign.id === previewCampaignId,
  );
  const previewCustomer = previewCampaign
    ? customers.find((customer) => customer.id === previewCampaign.previewCustomerId)
    : undefined;

  const projectedRevenue = campaigns
    .filter((campaign) => campaign.stream === activeStream)
    .reduce((sum, campaign) => sum + campaign.audience.projectedRevenue, 0);

  return (
    <div className="space-y-5">
      {/* ----------------------------- Header ----------------------------- */}
      <section className="rounded-basket border border-cream-300 bg-gradient-to-bl from-sage-100 via-cream-50 to-cream-200 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-sage-600" aria-hidden />
          <h1 className="text-xl font-bold tracking-tight">מרכז אישור קמפיינים</h1>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          המערכת בונה סגמנטים ומכינה הצעות בלבד. שום הודעה לא נשלחת ללקוחות לפני אישור אנושי
          מפורש, וכל פעולה נרשמת ביומן.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Stat icon={Clock} label="ממתינים לאישור" value={String(pendingAll.length)} />
          <Stat icon={Package} label="סה״כ הצעות" value={String(campaigns.length)} />
          <Stat
            icon={TrendingUp}
            label="צפי הכנסה בלשונית"
            value={formatPrice(projectedRevenue)}
          />
        </div>
        <p className="mt-3 text-xs text-ink-light">מאשר/ת מחובר/ת: {reviewer}</p>
      </section>

      {/* ------------------------------ Tabs ------------------------------ */}
      <div role="tablist" aria-label="סוגי קמפיינים" className="grid grid-cols-2 gap-2">
        {STREAM_TABS.map((tab) => {
          const inStream = campaigns.filter(
            (campaign) => campaign.stream === tab.stream,
          );
          const pending = inStream.filter(
            (campaign) => campaign.status === 'pending_approval',
          ).length;
          const isActive = activeStream === tab.stream;
          const isPrimary = tab.stream === 'lifecycle';

          return (
            <button
              key={tab.stream}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveStream(tab.stream)}
              className={cn(
                'rounded-basket border p-4 text-start transition-colors',
                isActive
                  ? isPrimary
                    ? 'border-terracotta-400 bg-terracotta-100'
                    : 'border-sage-400 bg-sage-100'
                  : 'border-cream-300 bg-cream-50 hover:border-cream-300 hover:bg-cream-100',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className={cn(
                    'font-bold leading-tight',
                    isPrimary ? 'text-base' : 'text-sm',
                    isActive && isPrimary && 'text-terracotta-600',
                  )}
                >
                  {tab.title}
                </p>
                {pending > 0 && (
                  <span className="ltr-nums grid min-w-5 shrink-0 place-items-center rounded-full bg-terracotta-400 px-1 text-[11px] font-semibold text-cream-50">
                    {pending}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-ink-muted">{tab.subtitle}</p>
              {isPrimary && (
                <p className="mt-2 inline-block rounded-full bg-cream-50/80 px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                  ערוץ ראשי · נפח גבוה
                </p>
              )}
            </button>
          );
        })}
      </div>

      {notice && (
        <p
          role="status"
          className={cn(
            'rounded-basket px-4 py-3 text-sm',
            notice.ok ? 'bg-sage-100 text-sage-600' : 'bg-blush-100 text-ink-muted',
          )}
        >
          {notice.text}
        </p>
      )}

      {/* ----------------------------- Queue ----------------------------- */}
      {visible.length === 0 ? (
        <p className="rounded-basket border border-dashed border-cream-300 bg-cream-50 p-8 text-center text-sm text-ink-muted">
          {activeStream === 'lifecycle'
            ? 'אין כרגע סגמנטים שוטפים. כל ההורים רכשו לאחרונה או שטרם הגיעו לצומת גדילה.'
            : 'לא זוהו אנומליות. אין הצעות שממתינות לטיפול.'}
        </p>
      ) : (
        <ul className="space-y-4">
          {visible.map((campaign) => (
            <li key={campaign.id}>
              <CampaignCard
                campaign={campaign}
                customers={customers}
                now={now}
                onApprove={onApprove}
                onReject={onReject}
                onEdit={onEdit}
                onSend={onSend}
                onPreview={() => setPreviewCampaignId(campaign.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {previewCampaign && previewCustomer && (
        <WhatsAppPreview
          campaign={previewCampaign}
          customer={previewCustomer}
          message={renderCampaignMessage(
            previewCampaign.copy.message,
            previewCustomer,
            now,
          )}
          onClose={() => setPreviewCampaignId(null)}
        />
      )}
    </div>
  );
}

function CampaignCard({
  campaign,
  customers,
  now,
  onApprove,
  onReject,
  onEdit,
  onSend,
  onPreview,
}: {
  campaign: Campaign;
  customers: CustomerProfile[];
  now: Date;
  onApprove: (campaignId: string) => void;
  onReject: (campaignId: string, reason: string) => void;
  onEdit: (campaignId: string, changes: Partial<CampaignCopy>) => void;
  onSend: (campaignId: string) => void;
  onPreview: () => void;
}) {
  const summary = buildReviewSummary(campaign);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<CampaignCopy>(campaign.copy);
  const [rejectReason, setRejectReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  const isPending = campaign.status === 'pending_approval';
  const status = STATUS_STYLES[campaign.status];
  const meta = TYPE_META[campaign.type];
  const TypeIcon = meta.icon;
  const previewCustomer = customers.find(
    (customer) => customer.id === campaign.previewCustomerId,
  );
  const audience = campaign.audience;
  const isWardrobeAov = audience.aovBasis === 'seasonal_wardrobe';

  return (
    <article className="overflow-hidden rounded-basket border border-cream-300 bg-cream-50 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-cream-200 bg-cream-100 px-5 py-3">
        <TypeIcon className="size-4 text-ink-muted" aria-hidden />
        <span className="text-xs font-medium text-ink-muted">{meta.label}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            SEVERITY_STYLES[campaign.severity],
          )}
        >
          {SEVERITY_LABELS[campaign.severity]}
        </span>
        <span
          className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', status.className)}
        >
          {status.label}
        </span>
        <span className="ltr-nums ms-auto text-[11px] text-ink-light">
          ודאות {Math.round(campaign.confidence * 100)}%
        </span>
      </div>

      <div className="space-y-4 p-5">
        {/* Segment + trigger chips */}
        <div>
          <h2 className="text-base font-bold leading-snug">{campaign.segment.label}</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {campaign.segment.triggers.map((trigger) => (
              <li
                key={trigger}
                className="rounded-full bg-sage-100 px-2.5 py-1 text-[11px] font-medium text-sage-600"
              >
                {trigger}
              </li>
            ))}
          </ul>
        </div>

        {/* Audience + revenue */}
        <div className="grid grid-cols-3 gap-2">
          <Metric
            label="קהל יעד (הערכה)"
            value={audience.estimatedReach.toLocaleString('en-US')}
            suffix="הורים"
          />
          <Metric
            label="צפי הכנסה"
            value={formatPrice(audience.projectedRevenue)}
            highlight
          />
          <Metric
            label={isWardrobeAov ? 'סל ממוצע' : 'פריט ממוצע'}
            value={formatPrice(audience.averageBasketValue)}
          />
        </div>
        <div className="-mt-2 space-y-1">
          <p className="text-[11px] leading-relaxed text-ink-light">
            חישוב מבוסס:{' '}
            <span className="ltr-nums font-medium">
              {audience.estimatedReach.toLocaleString('en-US')}
            </span>{' '}
            לקוחות ×{' '}
            <span className="ltr-nums font-medium">
              {Math.round(audience.assumedConversionRate * 100)}%
            </span>{' '}
            המרה צפויה ×{' '}
            <span className="ltr-nums font-medium">{audience.averageBasketValue}</span> ₪ סל
            ממוצע
          </p>
          <p className="text-[11px] leading-relaxed text-ink-light">
            {isWardrobeAov
              ? 'סל עונתי מלא (5-8 פריטי בסיס)'
              : 'פריט בודד ברכישת דחף'}{' '}
            · נגזר מ-<span className="ltr-nums">{audience.matchedInSample}</span> הורים בדגימה ·
            הערכה לתכנון, לא נתוני אמת.
          </p>
        </div>

        {/* Copy — editable while pending */}
        {isEditing ? (
          <div className="space-y-2.5">
            <input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              aria-label="כותרת הקמפיין"
              className="w-full rounded-xl border border-cream-300 bg-cream-100 px-3 py-2 text-sm font-semibold outline-none focus:border-terracotta-400"
            />
            <textarea
              value={draft.message}
              rows={5}
              onChange={(event) => setDraft({ ...draft, message: event.target.value })}
              aria-label="תוכן ההודעה"
              className="w-full rounded-xl border border-cream-300 bg-cream-100 px-3 py-2 text-sm leading-relaxed outline-none focus:border-terracotta-400"
            />
            <p className="text-[11px] text-ink-light">
              ניתן להשתמש בשדות אישיים: {'{{parentName}}'} · {'{{babyName}}'} ·{' '}
              {'{{babyAgeMonths}}'} · {'{{nextSize}}'} · {'{{upcomingSeason}}'}
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                אחוז הנחה
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.discountPercent}
                  onChange={(event) =>
                    setDraft({ ...draft, discountPercent: Number(event.target.value) })
                  }
                  className="ltr-nums w-20 rounded-lg border border-cream-300 bg-cream-100 px-2 py-1.5 text-sm outline-none focus:border-terracotta-400"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                כפתור פעולה
                <input
                  value={draft.ctaLabel}
                  onChange={(event) => setDraft({ ...draft, ctaLabel: event.target.value })}
                  className="w-44 rounded-lg border border-cream-300 bg-cream-100 px-2 py-1.5 text-sm outline-none focus:border-terracotta-400"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onEdit(campaign.id, draft);
                  setIsEditing(false);
                }}
                className="rounded-full bg-sage-400 px-4 py-2 text-xs font-semibold text-cream-50 hover:bg-sage-500"
              >
                שמירת טיוטה
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(campaign.copy);
                  setIsEditing(false);
                }}
                className="rounded-full border border-cream-300 px-4 py-2 text-xs font-medium text-ink-muted hover:bg-cream-100"
              >
                ביטול
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-cream-100 p-4">
            <p className="text-xs font-bold">{campaign.copy.title}</p>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-muted">
              {previewCustomer
                ? renderCampaignMessage(campaign.copy.message, previewCustomer, now)
                : campaign.copy.message}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-cream-200 px-2.5 py-1 text-ink-muted">
                {campaign.copy.ctaLabel}
              </span>
              {campaign.copy.discountPercent > 0 && (
                <span className="ltr-nums rounded-full bg-terracotta-100 px-2.5 py-1 font-semibold text-terracotta-600">
                  {campaign.copy.discountPercent}% הנחה
                </span>
              )}
              {summary.copyWasEdited && (
                <span className="rounded-full bg-sky-baby-200 px-2.5 py-1 text-ink">
                  נוסח נערך ידנית
                </span>
              )}
              {previewCustomer && (
                <span className="rounded-full bg-cream-200 px-2.5 py-1 text-ink-light">
                  מוצג עבור {previewCustomer.babyName}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Evidence */}
        <details className="rounded-2xl bg-cream-100 p-4">
          <summary className="cursor-pointer list-none text-xs font-bold">
            מה הפעיל את ההצעה
          </summary>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            {summary.whyItFired}
          </p>

          {campaign.evidence.lifecycleRows && (
            <ul className="mt-3 space-y-1.5">
              {campaign.evidence.lifecycleRows.map((row) => (
                <li
                  key={row.customerId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream-50 px-3 py-2 text-xs"
                >
                  <span className="font-medium">
                    {row.babyName} · {row.parentName}
                  </span>
                  <span className="ltr-nums text-ink-muted">
                    {row.babyAgeMonths} ח׳ · מידה {row.currentSize}
                    {row.nextSize ? `→${row.nextSize}` : ''} · לפני{' '}
                    {row.monthsSincePurchase} ח׳
                  </span>
                </li>
              ))}
            </ul>
          )}

          {campaign.evidence.temperatureDropC !== undefined && (
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Metric label="עכשיו" value={`${campaign.evidence.temperatureC}°`} />
              <Metric
                label="ממוצע שבועי"
                value={`${campaign.evidence.averageTemperatureC}°`}
              />
              <Metric
                label="פער"
                value={`${campaign.evidence.temperatureDropC > 0 ? '-' : '+'}${Math.abs(
                  campaign.evidence.temperatureDropC,
                )}°`}
                highlight
              />
            </dl>
          )}

          {campaign.evidence.surplusItems && (
            <ul className="mt-3 space-y-1.5">
              {campaign.evidence.surplusItems.map((entry) => (
                <li
                  key={entry.productId}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="min-w-0 truncate text-ink-muted">{entry.productName}</span>
                  <span className="ltr-nums shrink-0 font-medium text-terracotta-600">
                    +{entry.excessUnits} יח׳
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden />
              <span className="ltr-nums">{summary.reach}</span> נמענים בדגימה
            </span>
            {summary.products.length > 0 && (
              <span className="flex items-center gap-1.5">
                <Package className="size-3.5" aria-hidden />
                <span className="ltr-nums">{summary.products.length}</span> מוצרים
              </span>
            )}
          </div>
        </details>

        {summary.blockers.length > 0 && (
          <p className="flex items-start gap-2 rounded-2xl bg-blush-100 px-4 py-3 text-xs text-ink-muted">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {summary.blockers.join(' ')}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {previewCustomer && (
            <button
              type="button"
              onClick={onPreview}
              className="flex items-center gap-1.5 rounded-full border border-sage-300 bg-sage-100 px-4 py-2.5 text-xs font-semibold text-sage-600 transition-colors hover:bg-sage-200"
            >
              <MessageCircle className="size-3.5" aria-hidden />
              תצוגת וואטסאפ
            </button>
          )}

          {isPending && !isEditing && (
            <>
              <button
                type="button"
                onClick={() => onApprove(campaign.id)}
                disabled={summary.blockers.length > 0}
                className="flex items-center gap-1.5 rounded-full bg-sage-400 px-4 py-2.5 text-xs font-semibold text-cream-50 transition-colors hover:bg-sage-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="size-3.5" aria-hidden />
                אישור לשליחה
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 rounded-full border border-cream-300 px-4 py-2.5 text-xs font-medium text-ink transition-colors hover:bg-cream-100"
              >
                <Pencil className="size-3.5" aria-hidden />
                עריכת נוסח
              </button>
              <button
                type="button"
                onClick={() => setIsRejecting((value) => !value)}
                className="flex items-center gap-1.5 rounded-full border border-cream-300 px-4 py-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-blush-100"
              >
                <X className="size-3.5" aria-hidden />
                דחייה
              </button>
            </>
          )}

          {campaign.status === 'approved' && (
            <button
              type="button"
              onClick={() => onSend(campaign.id)}
              className="flex items-center gap-1.5 rounded-full bg-terracotta-400 px-4 py-2.5 text-xs font-semibold text-cream-50 transition-colors hover:bg-terracotta-500"
            >
              <Send className="size-3.5" aria-hidden />
              שליחה ל<span className="ltr-nums">{summary.reach}</span> נמענים
            </button>
          )}
        </div>

        {isPending && isRejecting && (
          <div className="flex gap-2">
            <input
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="סיבת הדחייה (חובה)"
              aria-label="סיבת הדחייה"
              className="min-w-0 flex-1 rounded-xl border border-cream-300 bg-cream-100 px-3 py-2 text-xs outline-none focus:border-terracotta-400"
            />
            <button
              type="button"
              onClick={() => {
                onReject(campaign.id, rejectReason);
                setRejectReason('');
                setIsRejecting(false);
              }}
              className="shrink-0 rounded-xl bg-ink-muted px-4 py-2 text-xs font-semibold text-cream-50 hover:bg-ink"
            >
              אישור דחייה
            </button>
          </div>
        )}

        {/* Audit trail */}
        <details className="group">
          <summary className="cursor-pointer list-none text-xs font-medium text-ink-muted underline underline-offset-4">
            יומן פעולות ({campaign.audit.length})
          </summary>
          <ol className="mt-2 space-y-1.5 border-s-2 border-cream-300 ps-3">
            {campaign.audit.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="text-xs text-ink-muted">
                <span className="font-medium text-ink">{entry.actor}</span> · {entry.note}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </article>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-cream-50/80 px-3.5 py-2 shadow-sm">
      <Icon className="size-4 text-sage-600" aria-hidden />
      <div className="leading-tight">
        <p className="ltr-nums text-base font-bold">{value}</p>
        <p className="text-[11px] text-ink-muted">{label}</p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
  highlight = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn('rounded-xl px-2 py-2', highlight ? 'bg-terracotta-100' : 'bg-cream-100')}>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'ltr-nums text-sm font-bold',
          highlight ? 'text-terracotta-600' : 'text-ink',
        )}
      >
        {value}
        {suffix && <span className="text-[10px] font-normal text-ink-muted"> {suffix}</span>}
      </dd>
    </div>
  );
}
