'use client';

import { useState } from 'react';
import {
  Bath,
  Bed,
  Blocks,
  Footprints,
  type LucideIcon,
  MessageCircle,
  Moon,
  Ruler,
  Send,
  Shirt,
  ShoppingBasket,
  Sparkles,
  Sun,
  Umbrella,
  Utensils,
  Wind,
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  SEASON_LABELS,
  SIZE_ORDER,
  STAGE_LABELS,
  type BasketItem,
  type CustomerProfile,
  type GeneratedBasket,
  type ProductCategory,
  type SizeCode,
} from '@/lib/types';
import { SIZE_BANDS, getSizeBand } from '@/lib/engine';
import { cn, formatPrice } from '@/lib/utils';

/** Feedback from the last basket manipulation, shown under the controls. */
export interface BasketNotice {
  text: string;
  ok: boolean;
}

interface ParentBasketViewProps {
  basket: GeneratedBasket;
  customer: CustomerProfile;
  /** Size currently selected in the control — the parent's pick, or the engine's. */
  activeSize: SizeCode;
  onApplySize: (size: SizeCode) => void;
  onNaturalLanguage: (query: string) => void;
  onReset: () => void;
  notice: BasketNotice | null;
  /** True once the parent edited the basket, enabling the reset affordance. */
  isEdited: boolean;
}

const CATEGORY_ICONS: Record<ProductCategory, LucideIcon> = {
  bodysuit: Shirt,
  footie: Shirt,
  crawling_pants: Shirt,
  sleep_sack: Moon,
  feeding_set: Utensils,
  outerwear: Wind,
  hat_accessories: Umbrella,
  socks_shoes: Footprints,
  bath_care: Bath,
  bedding: Bed,
  toys_development: Blocks,
  first_walk: Footprints,
};

const TRIGGER_STYLES: Record<BasketItem['trigger'], { label: string; className: string }> = {
  milestone_gap: { label: 'השלמת שלב', className: 'bg-sage-200 text-sage-600' },
  seasonal: { label: 'מותאם לעונה', className: 'bg-sky-baby-200 text-ink' },
  size_upgrade: { label: 'עלייה במידה', className: 'bg-terracotta-200 text-terracotta-600' },
  bestseller: { label: 'רב מכר', className: 'bg-blush-200 text-ink' },
  weather: { label: 'מזג אוויר', className: 'bg-sky-baby-300 text-ink' },
  surplus_promo: { label: 'מבצע מלאי', className: 'bg-cream-300 text-ink' },
};

export function ParentBasketView({
  basket,
  customer,
  activeSize,
  onApplySize,
  onNaturalLanguage,
  onReset,
  notice,
  isEdited,
}: ParentBasketViewProps) {
  const [query, setQuery] = useState('');
  const recommendedBand = getSizeBand(basket.growth.recommendedSize);

  const submitQuery = () => {
    if (!query.trim()) return;
    onNaturalLanguage(query.trim());
    setQuery('');
  };

  return (
    <div className="space-y-5">
      {/* ---------------------------- Hero ---------------------------- */}
      <section className="rounded-basket border border-cream-300 bg-gradient-to-bl from-blush-100 via-cream-50 to-sky-baby-100 p-5 shadow-sm">
        <p className="text-xs font-medium text-ink-muted">
          שלום {customer.name.split(' ')[0]}, הכנו סל אישי
        </p>
        <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight">
          {basket.headline}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{basket.summary}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Chip icon={Sparkles}>{STAGE_LABELS[basket.currentStage]}</Chip>
          <Chip icon={Ruler}>{recommendedBand.label}</Chip>
          <Chip icon={basket.season === 'winter' ? Wind : Sun}>
            {SEASON_LABELS[basket.season]}
          </Chip>
        </div>
      </section>

      {/* ------------------------ Growth ladder ------------------------ */}
      <section className="rounded-basket border border-cream-300 bg-cream-50 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Ruler className="size-4 text-sage-600" aria-hidden />
          <h2 className="text-sm font-bold">מדד הגדילה</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {basket.growth.explanation}
        </p>

        <ol className="mt-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="סולם מידות">
          {SIZE_BANDS.map((band) => {
            const isOwned = basket.growth.ownedSizes.includes(band.code);
            const isRecommended = band.code === basket.growth.recommendedSize;
            const isCurrent = band.code === basket.growth.currentSize;
            return (
              <li
                key={band.code}
                title={`${band.label} · ${band.heightCmRange.min}-${band.heightCmRange.max} ס"מ`}
                className={cn(
                  'ltr-nums shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold',
                  isRecommended && 'border-terracotta-400 bg-terracotta-400 text-cream-50',
                  !isRecommended && isCurrent && 'border-sage-400 bg-sage-100 text-sage-600',
                  !isRecommended && !isCurrent && isOwned &&
                    'border-sage-200 bg-sage-100 text-sage-600 opacity-70',
                  !isRecommended && !isCurrent && !isOwned &&
                    'border-cream-300 bg-cream-100 text-ink-light',
                )}
              >
                {band.code}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-ink-light">
          מודגש = המידה שהסל מותאם אליה · ירוק = מידות שכבר נרכשו
        </p>
      </section>

      {/* -------------------------- Controls -------------------------- */}
      <section className="rounded-basket border border-cream-300 bg-cream-50 p-5 shadow-sm">
        <h2 className="text-sm font-bold">התאמת הסל</h2>

        <label className="mt-3 block text-xs font-medium text-ink-muted" htmlFor="size-select">
          החלפת מידה לכל הפריטים בסל
        </label>
        <select
          id="size-select"
          value={activeSize}
          onChange={(event) => onApplySize(event.target.value as SizeCode)}
          className="mt-1.5 w-full rounded-xl border border-cream-300 bg-cream-100 px-3 py-2.5 text-sm outline-none transition-colors focus:border-terracotta-400"
        >
          {SIZE_ORDER.map((code) => (
            <option key={code} value={code}>
              {getSizeBand(code).label}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-xs font-medium text-ink-muted" htmlFor="nl-input">
          מה תרצו לשנות? כתבו לנו בחופשיות
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="nl-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitQuery();
            }}
            placeholder="לא רוצה מכנסיים קצרים לקיץ, מעדיפה ארוכים"
            className="min-w-0 flex-1 rounded-xl border border-cream-300 bg-cream-100 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-light focus:border-terracotta-400"
          />
          <button
            type="button"
            onClick={submitQuery}
            aria-label="שליחת הבקשה"
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-terracotta-400 text-cream-50 transition-colors hover:bg-terracotta-500"
          >
            <Send className="size-4" aria-hidden />
          </button>
        </div>

        {notice && (
          <p
            role="status"
            className={cn(
              'mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed',
              notice.ok ? 'bg-sage-100 text-sage-600' : 'bg-blush-100 text-ink-muted',
            )}
          >
            <MessageCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {notice.text}
          </p>
        )}

        {isEdited && (
          <button
            type="button"
            onClick={onReset}
            className="mt-3 text-xs font-medium text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            איפוס להמלצה המקורית
          </button>
        )}
      </section>

      {/* ---------------------------- Items ---------------------------- */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">הסל שלכם</h2>
          <span className="text-xs text-ink-muted">
            <span className="ltr-nums">{basket.items.length}</span> פריטים
          </span>
        </div>
        <ul className="space-y-3">
          {basket.items.map((item) => (
            <li key={item.product.id}>
              <BasketItemCard item={item} />
            </li>
          ))}
        </ul>
      </section>

      {/* --------------------------- Totals --------------------------- */}
      <section className="rounded-basket border border-sage-300 bg-sage-100 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-sage-600">סה״כ לתשלום</p>
            <p className="ltr-nums text-2xl font-bold text-ink">
              {formatPrice(basket.totalPrice)}
            </p>
            {basket.totalSavings > 0 && (
              <p className="ltr-nums mt-0.5 text-xs font-medium text-terracotta-600">
                חסכתם {formatPrice(basket.totalSavings)}
              </p>
            )}
          </div>
          <button
            type="button"
            className="flex items-center gap-2 rounded-full bg-terracotta-400 px-5 py-3 text-sm font-semibold text-cream-50 shadow-sm transition-colors hover:bg-terracotta-500"
          >
            <ShoppingBasket className="size-4" aria-hidden />
            להוספה לעגלה
          </button>
        </div>
      </section>

      {/* -------------------- Secondary suggestions -------------------- */}
      {basket.secondarySuggestions.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Wind className="size-4 text-ink-muted" aria-hidden />
            <h2 className="text-sm font-bold">אולי גם – בעקבות מזג האוויר</h2>
          </div>
          <p className="mb-3 text-xs text-ink-muted">
            הצעות משניות. הן לא מחליפות את הפריטים שהסל בנוי סביבם.
          </p>
          <ul className="space-y-3">
            {basket.secondarySuggestions.map((item) => (
              <li key={item.product.id}>
                <BasketItemCard item={item} isSecondary />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function BasketItemCard({
  item,
  isSecondary = false,
}: {
  item: BasketItem;
  isSecondary?: boolean;
}) {
  const Icon = CATEGORY_ICONS[item.product.category];
  const trigger = TRIGGER_STYLES[item.trigger];

  return (
    <article
      className={cn(
        'rounded-basket border p-4 shadow-sm transition-colors',
        isSecondary
          ? 'border-dashed border-sky-baby-300 bg-cream-50/60'
          : 'border-cream-300 bg-cream-50',
      )}
    >
      <div className="flex gap-3.5">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blush-100 to-sky-baby-100 text-ink-muted">
          <Icon className="size-6" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold leading-snug">{item.product.name}</h3>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                trigger.className,
              )}
            >
              {trigger.label}
            </span>
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{item.reason}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="ltr-nums font-bold text-ink">
              {formatPrice(item.product.price)}
            </span>
            {item.product.originalPrice && (
              <span className="ltr-nums text-ink-light line-through">
                {formatPrice(item.product.originalPrice)}
              </span>
            )}
            {item.quantity > 1 && (
              <Tag>
                כמות: <span className="ltr-nums">{item.quantity}</span>
              </Tag>
            )}
            {item.selectedSize && (
              <Tag className={item.parentAdjusted ? 'bg-terracotta-100 text-terracotta-600' : ''}>
                מידה <span className="ltr-nums">{item.selectedSize}</span>
              </Tag>
            )}
            {item.closesGap && <Tag>{CATEGORY_LABELS[item.closesGap]}</Tag>}
          </div>
        </div>
      </div>
    </article>
  );
}

function Chip({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-cream-50/80 px-3 py-1.5 text-xs font-medium text-ink shadow-sm">
      <Icon className="size-3.5 text-terracotta-500" aria-hidden />
      {children}
    </span>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('rounded-full bg-cream-200 px-2 py-0.5 text-ink-muted', className)}>
      {children}
    </span>
  );
}
