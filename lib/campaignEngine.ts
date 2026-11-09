/**
 * Campaign engine — builds every outbound campaign proposal, in two streams.
 *
 *   1. LIFECYCLE (primary, high volume) — the routine business case. Babies
 *      outgrow sizes on a predictable curve, seasons turn, and parents lapse.
 *      `detectLifecycleCampaigns` combines those three signals into segments.
 *
 *   2. ANOMALY (secondary, reactive) — cold snaps, heatwaves and warehouse
 *      overhang. Opportunistic, lower volume, and deliberately kept in its own
 *      queue so it never crowds out the routine milestone work.
 *
 * Human-in-the-loop is a hard constraint, not a setting. Every detector can only
 * ever produce proposals in `pending_approval`; there is no code path from a
 * detection to a dispatch. A campaign reaches `sent` only after a named reviewer
 * calls `approveCampaign` and then `markCampaignSent`, and every transition is
 * appended to an immutable audit trail.
 *
 * All functions are pure: they take state and return new state.
 */

import {
  CATEGORY_LABELS,
  SEASON_LABELS,
  type Campaign,
  type CampaignAudience,
  type CampaignAuditEntry,
  type CampaignCopy,
  type CampaignEvidence,
  type CampaignSegment,
  type CampaignStream,
  type CampaignType,
  type CustomerProfile,
  type LifecycleEvidenceRow,
  type Product,
  type Season,
  type WeatherSnapshot,
} from './types';
import { CUSTOMERS, PRODUCTS, WEATHER_SNAPSHOTS } from './mockData';
import {
  generateBasket,
  getCurrentSeason,
  getGrowthProjection,
  getSizeBand,
} from './engine';

/* -------------------------------------------------------------------------- */
/*                                 Thresholds                                  */
/* -------------------------------------------------------------------------- */

/** Signals that define the routine, high-volume lifecycle stream. */
export const LIFECYCLE_THRESHOLDS = {
  /** Months since the last order before a parent counts as drifting. */
  minMonthsSinceLastPurchase: 2.5,
  /** A size change this close counts as "about to transition". */
  sizeTransitionWindowMonths: 2,
  /** How far ahead to look for a season change, in days. */
  seasonLookaheadDays: 45,
} as const;

/** Signals that define the reactive anomaly stream. */
export const DETECTION_THRESHOLDS = {
  /** Degrees below the 7-day average that count as a cold snap. */
  coldSnapDropC: 5,
  /** A drop this large is treated as high severity. */
  severeColdSnapDropC: 9,
  /** Absolute temperature below which any drop matters for babies. */
  coldAbsoluteC: 18,
  /** Degrees above the 7-day average that count as a heatwave. */
  heatwaveRiseC: 5,
  /** Absolute temperature above which heat matters for babies. */
  hotAbsoluteC: 33,
  /** Units above `surplusThreshold` before a SKU is worth a campaign. */
  minExcessUnits: 20,
  /** Excess units that make a surplus high severity. */
  severeExcessUnits: 90,
  /** Discount proposed for surplus clearance, in percent. */
  proposedSurplusDiscount: 15,
  /** Weather campaigns lead with relevance, not price. */
  proposedWeatherDiscount: 0,
} as const;

/**
 * Unit economics for the revenue projection, calibrated to Israeli baby retail.
 *
 * The two streams sell fundamentally different things, so they cannot share a
 * single conversion rate or order value:
 *
 *   LIFECYCLE — a parent whose baby has outgrown a size has to buy; the order is
 *   a full seasonal base wardrobe (5-8 staples), so AOV is high and WhatsApp
 *   conversion is strong.
 *
 *   ANOMALY — a cold snap is a nudge, not a need. Most parents make do with what
 *   they own, so the segment is one city rather than the whole base, the order is
 *   a single impulse item (an extra fleece, a thermal sleep suit), and conversion
 *   is much lower.
 *
 * `matchedInSample` is real. Everything else is an ESTIMATE derived from these
 * constants; the dashboard shows the full arithmetic so a reviewer can judge it.
 * Replace the multipliers with real CRM segment counts before trusting the money.
 */
export const UNIT_ECONOMICS = {
  lifecycle: {
    /** Each matched profile in the seeded sample stands for this many real parents. */
    customersPerSampledParent: 620,
    /** Milestone segments span the active base, not one city. */
    segmentSize: { min: 1_200, max: 2_500 },
    /** Full seasonal wardrobe refresh, 5-8 staple items. */
    averageOrderValue: { min: 380, max: 480 },
    /** Highest where the need is most concrete — the baby no longer fits the size. */
    conversionRate: {
      growth_milestone: 0.18,
      season_shift: 0.15,
      replenishment: 0.12,
    },
  },
  anomaly: {
    /** Reactive segments are localised to the affected city. */
    customersPerSampledParent: 150,
    segmentSize: { min: 80, max: 160 },
    /** A single emergency item, not a wardrobe. */
    averageOrderValue: { min: 120, max: 160 },
    /** Lower urgency to buy anything new at all. */
    conversionRate: {
      cold_snap: 0.08,
      heatwave: 0.06,
      surplus_stock: 0.05,
    },
  },
} as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Median is used over mean so one expensive coat cannot skew an impulse AOV. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Size a segment and project its revenue: reach x conversion x order value.
 *
 * Lifecycle order value comes from actually running the basket engine for the
 * matched parents; anomaly order value is the median price of the promoted SKUs,
 * since those campaigns sell one item. Both are clamped into the calibrated band
 * for their stream so a thin sample cannot produce an implausible figure.
 */
function buildAudience(params: {
  stream: CampaignStream;
  type: CampaignType;
  matched: CustomerProfile[];
  now: Date;
  /** Promoted SKUs — required for anomaly campaigns, unused for lifecycle. */
  products?: Product[];
}): CampaignAudience {
  const { stream, type, matched, now, products = [] } = params;
  const model = stream === 'lifecycle' ? UNIT_ECONOMICS.lifecycle : UNIT_ECONOMICS.anomaly;

  const estimatedReach = Math.round(
    clamp(
      matched.length * model.customersPerSampledParent,
      model.segmentSize.min,
      model.segmentSize.max,
    ),
  );

  const rawOrderValue =
    stream === 'lifecycle'
      ? // What these parents would actually be sold, straight from the engine.
        median(matched.map((customer) => generateBasket(customer, { now }).totalPrice))
      : // One item off the promoted shelf.
        median(products.map((product) => product.price));

  const averageOrderValue = round2(
    clamp(rawOrderValue, model.averageOrderValue.min, model.averageOrderValue.max),
  );

  const conversionRates: Record<string, number> = model.conversionRate;
  const assumedConversionRate = conversionRates[type] ?? 0.1;

  return {
    matchedInSample: matched.length,
    estimatedReach,
    assumedConversionRate,
    averageBasketValue: averageOrderValue,
    aovBasis: stream === 'lifecycle' ? 'seasonal_wardrobe' : 'single_item',
    projectedRevenue: Math.round(
      estimatedReach * assumedConversionRate * averageOrderValue,
    ),
  };
}

/** Categories that answer a cold snap. */
const WARM_CATEGORIES = ['outerwear', 'sleep_sack', 'footie', 'hat_accessories'] as const;

/** Categories that answer a heatwave. */
const COOL_CATEGORIES = ['hat_accessories', 'bodysuit', 'crawling_pants', 'sleep_sack'] as const;

const nowIso = (now: Date): string => now.toISOString();

const auditEntry = (
  at: string,
  action: CampaignAuditEntry['action'],
  actor: string,
  note: string,
): CampaignAuditEntry => ({ at, action, actor, note });

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

/** Whole-ish months between two dates, to one decimal place. */
export function monthsBetween(from: string | Date, to: Date): number {
  const fromDate = typeof from === 'string' ? new Date(from) : from;
  return Math.round(((to.getTime() - fromDate.getTime()) / MS_PER_MONTH) * 10) / 10;
}

/** The season the calendar is heading into, `seasonLookaheadDays` from now. */
export function getUpcomingSeason(now: Date): Season {
  const ahead = new Date(
    now.getTime() + LIFECYCLE_THRESHOLDS.seasonLookaheadDays * 24 * 60 * 60 * 1000,
  );
  return getCurrentSeason(ahead);
}

/** Hebrew phrasing for entering a season, e.g. "כניסה לחורף". */
const enteringSeasonLabel = (season: Season): string =>
  season === 'transitional' ? 'כניסה לעונת מעבר' : `כניסה ל${SEASON_LABELS[season]}`;

/* -------------------------------------------------------------------------- */
/*                     Lifecycle stream (primary, high volume)                 */
/* -------------------------------------------------------------------------- */

/** Everything the lifecycle detector works out about one parent. */
interface LifecycleSignals {
  customer: CustomerProfile;
  monthsSincePurchase: number;
  isLapsed: boolean;
  hasSizeTransition: boolean;
  hasSeasonShift: boolean;
  currentSize: LifecycleEvidenceRow['currentSize'];
  nextSize: LifecycleEvidenceRow['nextSize'];
  upcomingSeason: Season;
}

/** Evaluate the three lifecycle signals for one customer. */
export function getLifecycleSignals(
  customer: CustomerProfile,
  now: Date,
): LifecycleSignals {
  const monthsSincePurchase = monthsBetween(customer.lastPurchaseDate, now);
  const growth = getGrowthProjection(customer);
  const upcomingSeason = getUpcomingSeason(now);

  const hasSizeTransition =
    growth.nextSize !== null &&
    (growth.upgradedFromOwnedSize ||
      (growth.monthsToNextSize !== null &&
        growth.monthsToNextSize <= LIFECYCLE_THRESHOLDS.sizeTransitionWindowMonths));

  return {
    customer,
    monthsSincePurchase,
    isLapsed:
      monthsSincePurchase >= LIFECYCLE_THRESHOLDS.minMonthsSinceLastPurchase,
    hasSizeTransition,
    hasSeasonShift: upcomingSeason !== getCurrentSeason(now),
    currentSize: growth.currentSize,
    nextSize: growth.nextSize,
    upcomingSeason,
  };
}

/** Which lifecycle campaign a lapsed parent belongs in. */
function classifyLifecycle(signals: LifecycleSignals): CampaignType {
  if (signals.hasSizeTransition) return 'growth_milestone';
  return signals.hasSeasonShift ? 'season_shift' : 'replenishment';
}

const LIFECYCLE_TITLES: Record<string, string> = {
  growth_milestone: 'מעבר מידה',
  season_shift: 'היערכות לעונה החדשה',
  replenishment: 'חידוש קשר והשלמת מלתחה',
};

/**
 * Build the routine lifecycle campaigns.
 *
 * A parent enters the funnel only once they have gone quiet for
 * `minMonthsSinceLastPurchase`. They are then grouped by what changed for them —
 * a size jump, a season turning, or neither — so one approval covers a whole
 * segment rather than one parent at a time.
 */
export function detectLifecycleCampaigns(
  options: { customers?: CustomerProfile[]; now?: Date } = {},
): Campaign[] {
  const { customers = CUSTOMERS, now = new Date() } = options;
  const detectedAt = nowIso(now);

  const lapsed = customers
    .filter((customer) => customer.marketingOptIn)
    .map((customer) => getLifecycleSignals(customer, now))
    .filter((signals) => signals.isLapsed);

  // One campaign per (reason, upcoming season) pair.
  const groups = new Map<string, LifecycleSignals[]>();
  for (const signals of lapsed) {
    const key = `${classifyLifecycle(signals)}|${signals.upcomingSeason}`;
    groups.set(key, [...(groups.get(key) ?? []), signals]);
  }

  const campaigns: Campaign[] = [];

  for (const [key, members] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const [type, season] = key.split('|') as [CampaignType, Season];
    const sorted = [...members].sort((a, b) =>
      a.customer.id.localeCompare(b.customer.id),
    );
    const matched = sorted.map((signals) => signals.customer);
    const audience = buildAudience({ stream: 'lifecycle', type, matched, now });

    const minMonths = Math.min(...sorted.map((s) => s.monthsSincePurchase));
    const sizeJumps = [
      ...new Set(
        sorted
          .filter((s) => s.nextSize)
          .map((s) => `${s.currentSize}→${s.nextSize}`),
      ),
    ];

    const triggers = [
      `עברו ${Math.floor(minMonths)}+ חודשים מהרכישה האחרונה`,
      ...(type === 'growth_milestone' && sizeJumps.length > 0
        ? [`קפיצת מידה ${sizeJumps.join(', ')}`]
        : []),
      ...(sorted.some((s) => s.hasSeasonShift) ? [enteringSeasonLabel(season)] : []),
    ];

    const segment: CampaignSegment = {
      label:
        type === 'growth_milestone'
          ? `מעבר מידה + ${enteringSeasonLabel(season)}`
          : `${LIFECYCLE_TITLES[type]} · ${SEASON_LABELS[season]}`,
      triggers,
    };

    /*
     * The message is a TEMPLATE, not finished copy: one approval covers a whole
     * segment, so every recipient gets their own baby's name, age and size.
     * `renderCampaignMessage` resolves it per parent.
     */
    const copy: CampaignCopy = {
      title: `${LIFECYCLE_TITLES[type]} – ${SEASON_LABELS[season]}`,
      message:
        type === 'growth_milestone'
          ? 'היי {{parentName}}, שמנו לב שעברו {{monthsSincePurchase}} חודשים מהרכישה האחרונה. {{babyName}} כבר {{ageWord}} {{babyAgeMonths}} חודשים {{transitionClause}} לקראת {{upcomingSeason}}. הכנו לך סל מותאם אישית להשלמת המלתחה והשלב ההתפתחותי הבא.'
          : type === 'season_shift'
            ? 'היי {{parentName}}, {{upcomingSeason}} כבר כאן ועברו {{monthsSincePurchase}} חודשים מהרכישה האחרונה. אספנו ל{{babyName}} סל מותאם לעונה ולשלב ההתפתחותי הנוכחי.'
            : 'היי {{parentName}}, מזמן לא התראינו. {{babyName}} כבר {{ageWord}} {{babyAgeMonths}} חודשים, והכנו סל שמשלים בדיוק את מה שחסר בארון.',
      ctaLabel: 'צפי בסל המותאם אישית 🛍️',
      discountPercent: 0,
    };

    const lifecycleRows: LifecycleEvidenceRow[] = sorted.map((signals) => ({
      customerId: signals.customer.id,
      parentName: signals.customer.name,
      babyName: signals.customer.babyName,
      babyAgeMonths: signals.customer.babyAgeMonths,
      monthsSincePurchase: signals.monthsSincePurchase,
      currentSize: signals.currentSize,
      nextSize: signals.nextSize,
    }));

    const evidence: CampaignEvidence = { lifecycleRows, upcomingSeason: season };

    campaigns.push({
      id: `camp-life-${type}-${season}`,
      stream: 'lifecycle',
      type,
      segment,
      audience,
      previewCustomerId: matched[0]?.id ?? null,
      copy,
      originalCopy: { ...copy },
      productIds: [],
      targetCustomerIds: matched.map((customer) => customer.id),
      status: 'pending_approval',
      detectedAt,
      triggerReason: triggers.join(' • '),
      evidence,
      confidence: type === 'growth_milestone' ? 0.9 : 0.75,
      severity: type === 'growth_milestone' ? 'high' : 'medium',
      audit: [
        auditEntry(
          detectedAt,
          'detected',
          'system',
          `נבנה סגמנט שוטף (${segment.label}); ההצעה ממתינה לאישור אנושי.`,
        ),
      ],
      reviewedBy: null,
      reviewedAt: null,
    });
  }

  return campaigns;
}

/* -------------------------------------------------------------------------- */
/*                          Per-recipient message copy                         */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a campaign message template against one recipient.
 *
 * Gendered wording is resolved from the baby's gender; babies recorded as
 * `unisex` get neutral phrasing rather than a guess.
 */
export function renderCampaignMessage(
  template: string,
  customer: CustomerProfile,
  now: Date = new Date(),
): string {
  const signals = getLifecycleSignals(customer, now);
  const isGirl = customer.babyGender === 'girl';
  const isNeutral = customer.babyGender === 'unisex';
  const nextSizeLabel = signals.nextSize ? getSizeBand(signals.nextSize).code : null;

  const transitionClause = !nextSizeLabel
    ? 'ובקרוב שלב חדש'
    : isNeutral
      ? `והמידה הבאה בתור היא ${nextSizeLabel}`
      : isGirl
        ? `וצפויה לעבור למידה ${nextSizeLabel}`
        : `וצפוי לעבור למידה ${nextSizeLabel}`;

  const replacements: Record<string, string> = {
    parentName: customer.name.split(' ')[0],
    babyName: customer.babyName,
    babyAgeMonths: String(customer.babyAgeMonths),
    monthsSincePurchase: String(Math.floor(signals.monthsSincePurchase)),
    currentSize: signals.currentSize,
    nextSize: nextSizeLabel ?? signals.currentSize,
    upcomingSeason: SEASON_LABELS[signals.upcomingSeason],
    ageWord: isNeutral ? 'בגיל' : isGirl ? 'בת' : 'בן',
    transitionClause,
  };

  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in replacements ? replacements[key] : match,
  );
}

/* -------------------------------------------------------------------------- */
/*                    Anomaly stream (secondary, reactive)                     */
/* -------------------------------------------------------------------------- */

/**
 * Weather anomalies, in both directions.
 *
 * A city is compared against its OWN 7-day average, so Jerusalem is not flagged
 * every winter merely for being colder than Eilat. Cold snaps pull warm layers;
 * heatwaves pull sun protection and breathable fabrics.
 */
export function detectWeatherAnomalies(
  options: {
    weather?: WeatherSnapshot[];
    customers?: CustomerProfile[];
    catalog?: Product[];
    now?: Date;
  } = {},
): Campaign[] {
  const {
    weather = WEATHER_SNAPSHOTS,
    customers = CUSTOMERS,
    catalog = PRODUCTS,
    now = new Date(),
  } = options;

  const detectedAt = nowIso(now);
  const campaigns: Campaign[] = [];

  for (const snapshot of weather) {
    const dropC = snapshot.averageTemperatureC - snapshot.temperatureC;
    const riseC = -dropC;

    const isColdSnap =
      dropC >= DETECTION_THRESHOLDS.coldSnapDropC ||
      (snapshot.temperatureC <= DETECTION_THRESHOLDS.coldAbsoluteC && dropC > 0);
    const isHeatwave =
      riseC >= DETECTION_THRESHOLDS.heatwaveRiseC ||
      (snapshot.temperatureC >= DETECTION_THRESHOLDS.hotAbsoluteC && riseC > 0);
    if (!isColdSnap && !isHeatwave) continue;

    const type: CampaignType = isColdSnap ? 'cold_snap' : 'heatwave';
    const deltaC = isColdSnap ? dropC : riseC;

    // Only opted-in customers in the affected city are ever targeted.
    const targets = customers.filter(
      (customer) => customer.city === snapshot.city && customer.marketingOptIn,
    );
    if (targets.length === 0) continue;

    const youngestAge = Math.min(...targets.map((customer) => customer.babyAgeMonths));
    const relevantCategories: readonly string[] = isColdSnap
      ? WARM_CATEGORIES
      : COOL_CATEGORIES;
    const relevantSeasons: Season[] = isColdSnap
      ? ['winter', 'transitional']
      : ['summer', 'all_season'];

    const products = catalog
      .filter(
        (product) =>
          product.stock > 0 &&
          relevantCategories.includes(product.category) &&
          relevantSeasons.includes(product.season) &&
          product.ageRange.minMonths <= youngestAge + 6 &&
          product.ageRange.maxMonths > youngestAge,
      )
      .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
      .slice(0, 4);
    if (products.length === 0) continue;

    const roundedDelta = Math.round(deltaC);
    const copy: CampaignCopy = isColdSnap
      ? {
          title: `ירידה חדה בטמפרטורות ב${snapshot.city}`,
          message: `הטמפרטורה ב${snapshot.city} ירדה ל-${Math.round(snapshot.temperatureC)}° – כ-${roundedDelta}° מתחת לממוצע השבועי. אספנו שכבות חימום מתאימות לגיל של התינוק שלכם, כדי שהמעבר לקור יהיה רגוע.`,
          ctaLabel: 'לצפייה בשכבות החימום',
          discountPercent: DETECTION_THRESHOLDS.proposedWeatherDiscount,
        }
      : {
          title: `גל חום ב${snapshot.city}`,
          message: `הטמפרטורה ב${snapshot.city} טיפסה ל-${Math.round(snapshot.temperatureC)}° – כ-${roundedDelta}° מעל הממוצע השבועי. ריכזנו פריטים נושמים והגנה מהשמש שמתאימים לגיל של התינוק שלכם.`,
          ctaLabel: 'לצפייה בפריטים המאווררים',
          discountPercent: DETECTION_THRESHOLDS.proposedWeatherDiscount,
        };

    const evidence: CampaignEvidence = {
      city: snapshot.city,
      temperatureC: snapshot.temperatureC,
      averageTemperatureC: snapshot.averageTemperatureC,
      temperatureDropC: Math.round(dropC * 10) / 10,
    };

    const severity: Campaign['severity'] =
      deltaC >= DETECTION_THRESHOLDS.severeColdSnapDropC
        ? 'high'
        : deltaC >= DETECTION_THRESHOLDS.coldSnapDropC
          ? 'medium'
          : 'low';

    campaigns.push({
      id: `camp-${isColdSnap ? 'cold' : 'heat'}-${snapshot.city}-${snapshot.recordedAt.slice(0, 10)}`,
      stream: 'anomaly',
      type,
      segment: {
        label: `${isColdSnap ? 'גל קור' : 'גל חום'} · ${snapshot.city}`,
        triggers: [
          `${Math.round(snapshot.temperatureC)}° כרגע`,
          `${roundedDelta}° ${isColdSnap ? 'מתחת ל' : 'מעל ה'}ממוצע השבועי`,
          `הורים ב${snapshot.city}`,
        ],
      },
      audience: buildAudience({ stream: 'anomaly', type, matched: targets, now, products }),
      previewCustomerId: targets[0]?.id ?? null,
      copy,
      originalCopy: { ...copy },
      productIds: products.map((product) => product.id),
      targetCustomerIds: targets.map((customer) => customer.id),
      status: 'pending_approval',
      detectedAt,
      triggerReason: isColdSnap
        ? `ירידה של ${roundedDelta}° מתחת לממוצע השבועי ב${snapshot.city} (${Math.round(snapshot.temperatureC)}° מול ממוצע ${Math.round(snapshot.averageTemperatureC)}°).`
        : `עלייה של ${roundedDelta}° מעל הממוצע השבועי ב${snapshot.city} (${Math.round(snapshot.temperatureC)}° מול ממוצע ${Math.round(snapshot.averageTemperatureC)}°).`,
      evidence,
      confidence: Math.min(0.95, 0.5 + deltaC / 20),
      severity,
      audit: [
        auditEntry(
          detectedAt,
          'detected',
          'system',
          `זוהתה אנומליית מזג אוויר ב${snapshot.city}; ההצעה ממתינה לאישור אנושי.`,
        ),
      ],
      reviewedBy: null,
      reviewedAt: null,
    });
  }

  return campaigns.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Flags SKUs sitting meaningfully above their own surplus threshold and groups
 * them into a single clearance proposal, so a reviewer approves one campaign
 * rather than a dozen near-identical ones.
 */
export function detectStockSurpluses(
  options: {
    catalog?: Product[];
    customers?: CustomerProfile[];
    now?: Date;
  } = {},
): Campaign[] {
  const { catalog = PRODUCTS, customers = CUSTOMERS, now = new Date() } = options;
  const detectedAt = nowIso(now);

  const surplus = catalog
    .map((product) => ({
      product,
      excessUnits: product.stock - product.surplusThreshold,
    }))
    .filter((entry) => entry.excessUnits >= DETECTION_THRESHOLDS.minExcessUnits)
    .sort(
      (a, b) => b.excessUnits - a.excessUnits || a.product.id.localeCompare(b.product.id),
    );

  if (surplus.length === 0) return [];

  const surplusProducts = surplus.slice(0, 5);
  const categories = [
    ...new Set(surplusProducts.map((entry) => entry.product.category)),
  ];

  // Target opted-in parents whose baby's age overlaps at least one surplus SKU.
  const targets = customers.filter(
    (customer) =>
      customer.marketingOptIn &&
      surplusProducts.some(
        ({ product }) =>
          product.ageRange.minMonths <= customer.babyAgeMonths + 3 &&
          product.ageRange.maxMonths > customer.babyAgeMonths,
      ),
  );
  if (targets.length === 0) return [];

  const categoryLabels = categories.map((category) => CATEGORY_LABELS[category]);
  // A five-category title is unreadable in the review queue and in a push notification.
  const categoryText =
    categoryLabels.length > 2
      ? `${categoryLabels.slice(0, 2).join(', ')} ועוד`
      : categoryLabels.join(' ו');
  const discount = DETECTION_THRESHOLDS.proposedSurplusDiscount;

  const copy: CampaignCopy = {
    title: `מבצע מלאי: ${categoryText}`,
    message: `יש לנו עודף מלאי ב${categoryText}, ולכן הכנו הנחה של ${discount}% על פריטים נבחרים שמתאימים בדיוק לגיל של התינוק שלכם. ההצעה תקפה עד גמר המלאי.`,
    ctaLabel: 'לצפייה בפריטים',
    discountPercent: discount,
  };

  const totalExcess = surplusProducts.reduce(
    (sum, entry) => sum + entry.excessUnits,
    0,
  );

  const evidence: CampaignEvidence = {
    surplusItems: surplusProducts.map(({ product, excessUnits }) => ({
      productId: product.id,
      productName: product.name,
      stock: product.stock,
      surplusThreshold: product.surplusThreshold,
      excessUnits,
    })),
  };

  return [
    {
      id: `camp-surplus-${detectedAt.slice(0, 10)}`,
      stream: 'anomaly',
      type: 'surplus_stock',
      segment: {
        label: `עודף מלאי · ${categoryText}`,
        triggers: [
          `${surplusProducts.length} מק"טים חורגים מהסף`,
          `${totalExcess} יחידות עודפות`,
          `הנחה מוצעת ${discount}%`,
        ],
      },
      audience: buildAudience({
        stream: 'anomaly',
        type: 'surplus_stock',
        matched: targets,
        now,
        products: surplusProducts.map((entry) => entry.product),
      }),
      previewCustomerId: targets[0]?.id ?? null,
      copy,
      originalCopy: { ...copy },
      productIds: surplusProducts.map((entry) => entry.product.id),
      targetCustomerIds: targets.map((customer) => customer.id),
      status: 'pending_approval',
      detectedAt,
      triggerReason: `${surplusProducts.length} מק"טים חורגים מסף המלאי שלהם ב-${totalExcess} יחידות במצטבר.`,
      evidence,
      confidence: Math.min(0.9, 0.55 + totalExcess / 1000),
      severity:
        totalExcess >= DETECTION_THRESHOLDS.severeExcessUnits ? 'high' : 'medium',
      audit: [
        auditEntry(
          detectedAt,
          'detected',
          'system',
          'זוהה עודף מלאי; ההצעה ממתינה לאישור אנושי.',
        ),
      ],
      reviewedBy: null,
      reviewedAt: null,
    },
  ];
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

const byUrgency = (a: Campaign, b: Campaign): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  b.confidence - a.confidence ||
  a.id.localeCompare(b.id);

/** Reactive stream only: weather anomalies and stock overhang. */
export function detectAnomalyCampaigns(
  options: {
    weather?: WeatherSnapshot[];
    customers?: CustomerProfile[];
    catalog?: Product[];
    now?: Date;
  } = {},
): Campaign[] {
  return [...detectWeatherAnomalies(options), ...detectStockSurpluses(options)].sort(
    byUrgency,
  );
}

/**
 * The full review queue. Lifecycle campaigns lead: they are the primary business
 * case, and a reactive weather alert should never push them down the page.
 */
export function detectAllCampaigns(
  options: {
    weather?: WeatherSnapshot[];
    customers?: CustomerProfile[];
    catalog?: Product[];
    now?: Date;
  } = {},
): Campaign[] {
  return [
    ...detectLifecycleCampaigns(options).sort(byUrgency),
    ...detectAnomalyCampaigns(options),
  ];
}

/** Split a queue by stream, for the dashboard's two tabs. */
export const filterByStream = (
  campaigns: Campaign[],
  stream: CampaignStream,
): Campaign[] => campaigns.filter((campaign) => campaign.stream === stream);


/* -------------------------------------------------------------------------- */
/*                        Human-in-the-loop review API                         */
/* -------------------------------------------------------------------------- */

/** Everything a reviewer needs to judge a proposal at a glance. */
export interface CampaignReviewSummary {
  campaign: Campaign;
  /** Hebrew, human-readable restatement of the trigger. */
  whyItFired: string;
  /** Number of customers who would receive the message. */
  reach: number;
  /** Products promoted, resolved from the catalog. */
  products: Product[];
  /** True when a reviewer changed the copy the detector proposed. */
  copyWasEdited: boolean;
  /** Blocking reasons that must clear before approval is allowed. */
  blockers: string[];
}

/** True only for campaigns still awaiting a decision. */
export const isPendingApproval = (campaign: Campaign): boolean =>
  campaign.status === 'pending_approval';

export const getPendingCampaigns = (campaigns: Campaign[]): Campaign[] =>
  campaigns.filter(isPendingApproval);

/** Assemble the review packet shown in the marketing manager's queue. */
export function buildReviewSummary(
  campaign: Campaign,
  catalog: Product[] = PRODUCTS,
): CampaignReviewSummary {
  const products = campaign.productIds
    .map((id) => catalog.find((product) => product.id === id))
    .filter((product): product is Product => Boolean(product));

  const blockers: string[] = [];
  if (campaign.targetCustomerIds.length === 0) {
    blockers.push('אין נמענים מאושרים לקמפיין.');
  }
  /*
   * Only anomaly campaigns promote a fixed product list. A lifecycle campaign
   * deliberately carries none: each recipient is sent their own engine-generated
   * basket, so an empty list is correct there and must not block approval.
   */
  if (campaign.stream === 'anomaly' && products.length === 0) {
    blockers.push('לא נמצאו מוצרים זמינים לקמפיין.');
  }
  if (products.some((product) => product.stock === 0)) {
    blockers.push('אחד המוצרים אזל מהמלאי.');
  }
  if (campaign.copy.discountPercent < 0 || campaign.copy.discountPercent > 100) {
    blockers.push('אחוז ההנחה חייב להיות בין 0 ל-100.');
  }
  if (!campaign.copy.title.trim() || !campaign.copy.message.trim()) {
    blockers.push('כותרת או תוכן הודעה חסרים.');
  }

  return {
    campaign,
    whyItFired: campaign.triggerReason,
    reach: campaign.targetCustomerIds.length,
    products,
    copyWasEdited:
      JSON.stringify(campaign.copy) !== JSON.stringify(campaign.originalCopy),
    blockers,
  };
}

/** Result of any reviewer action: the new campaign, or a refusal with a reason. */
export interface CampaignActionResult {
  campaign: Campaign;
  ok: boolean;
  /** Hebrew explanation, shown to the reviewer when `ok` is false. */
  message: string;
}

/**
 * Edit the customer-facing copy or discount before approving.
 * Only pending campaigns are editable — approved copy is frozen for audit.
 */
export function editCampaignCopy(
  campaign: Campaign,
  changes: Partial<CampaignCopy>,
  reviewer: string,
  now: Date = new Date(),
): CampaignActionResult {
  if (!isPendingApproval(campaign)) {
    return {
      campaign,
      ok: false,
      message: 'ניתן לערוך רק קמפיינים שממתינים לאישור.',
    };
  }

  const copy: CampaignCopy = { ...campaign.copy, ...changes };
  if (copy.discountPercent < 0 || copy.discountPercent > 100) {
    return { campaign, ok: false, message: 'אחוז ההנחה חייב להיות בין 0 ל-100.' };
  }

  const changedFields = (Object.keys(changes) as Array<keyof CampaignCopy>).filter(
    (field) => changes[field] !== undefined && changes[field] !== campaign.copy[field],
  );
  if (changedFields.length === 0) {
    return { campaign, ok: true, message: 'לא בוצעו שינויים.' };
  }

  return {
    campaign: {
      ...campaign,
      copy,
      audit: [
        ...campaign.audit,
        auditEntry(
          nowIso(now),
          'edited',
          reviewer,
          `עודכנו השדות: ${changedFields.join(', ')}.`,
        ),
      ],
    },
    ok: true,
    message: 'הטיוטה עודכנה. הקמפיין עדיין ממתין לאישור.',
  };
}

/**
 * Explicit human approval. Refuses while any blocker stands, so a reviewer
 * cannot approve a campaign with no audience or an out-of-stock product.
 */
export function approveCampaign(
  campaign: Campaign,
  reviewer: string,
  options: { note?: string; catalog?: Product[]; now?: Date } = {},
): CampaignActionResult {
  const { note, catalog = PRODUCTS, now = new Date() } = options;

  if (!isPendingApproval(campaign)) {
    return {
      campaign,
      ok: false,
      message: `לא ניתן לאשר קמפיין בסטטוס "${campaign.status}".`,
    };
  }
  if (!reviewer.trim()) {
    return { campaign, ok: false, message: 'נדרש מזהה מאשר לצורך תיעוד.' };
  }

  const { blockers } = buildReviewSummary(campaign, catalog);
  if (blockers.length > 0) {
    return {
      campaign,
      ok: false,
      message: `לא ניתן לאשר: ${blockers.join(' ')}`,
    };
  }

  const at = nowIso(now);
  return {
    campaign: {
      ...campaign,
      status: 'approved',
      reviewedBy: reviewer,
      reviewedAt: at,
      audit: [
        ...campaign.audit,
        auditEntry(at, 'approved', reviewer, note ?? 'אושר לשליחה.'),
      ],
    },
    ok: true,
    message: 'הקמפיין אושר וממתין לשליחה.',
  };
}

/** Reject a proposal. A reason is mandatory so the detector can be tuned later. */
export function rejectCampaign(
  campaign: Campaign,
  reviewer: string,
  reason: string,
  now: Date = new Date(),
): CampaignActionResult {
  if (!isPendingApproval(campaign)) {
    return {
      campaign,
      ok: false,
      message: `לא ניתן לדחות קמפיין בסטטוס "${campaign.status}".`,
    };
  }
  if (!reason.trim()) {
    return { campaign, ok: false, message: 'נדרשת סיבת דחייה.' };
  }

  const at = nowIso(now);
  return {
    campaign: {
      ...campaign,
      status: 'rejected',
      reviewedBy: reviewer,
      reviewedAt: at,
      audit: [...campaign.audit, auditEntry(at, 'rejected', reviewer, reason)],
    },
    ok: true,
    message: 'הקמפיין נדחה ולא יישלח.',
  };
}

/**
 * Dispatch gate. Deliberately separate from `approveCampaign`: a campaign can
 * only be sent after a human has already approved it, so an accidental call
 * here cannot skip review.
 */
export function markCampaignSent(
  campaign: Campaign,
  actor: string,
  now: Date = new Date(),
): CampaignActionResult {
  if (campaign.status !== 'approved') {
    return {
      campaign,
      ok: false,
      message: 'ניתן לשלוח רק קמפיין שאושר על ידי גורם אנושי.',
    };
  }

  const at = nowIso(now);
  return {
    campaign: {
      ...campaign,
      status: 'sent',
      audit: [
        ...campaign.audit,
        auditEntry(
          at,
          'sent',
          actor,
          campaign.targetCustomerIds.length === 1
            ? 'נשלח לנמען אחד.'
            : `נשלח ל-${campaign.targetCustomerIds.length} נמענים.`,
        ),
      ],
    },
    ok: true,
    message: 'הקמפיין נשלח.',
  };
}
