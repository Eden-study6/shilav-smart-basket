/**
 * Core recommendation engine for the Personalized Milestone Basket.
 *
 * Priority order, by design:
 *   1. Developmental milestones (what the baby needs at this stage)
 *   2. Generic seasonality (what the calendar says, not today's forecast)
 *   3. Everything else — weather anomalies are demoted to `secondarySuggestions`
 *      and never compete with a milestone gap for a slot in the main basket.
 *
 * Every function here is pure and deterministic: the same inputs always produce
 * the same basket, so the demo is reproducible. Ties break on product id.
 */

import {
  CATEGORY_LABELS,
  SIZE_ORDER,
  STAGE_LABELS,
  type BasketItem,
  type BasketModification,
  type BasketModificationResult,
  type CustomerProfile,
  type GeneratedBasket,
  type GrowthProjection,
  type MilestoneRule,
  type ParsedIntent,
  type Product,
  type ProductCategory,
  type PurchaseHistory,
  type Season,
  type SizeBand,
  type SizeCode,
  type MilestoneStage,
} from './types';
import {
  MILESTONE_RULES,
  PRODUCTS,
  PURCHASE_HISTORY,
  getPurchaseHistoryForCustomer,
} from './mockData';

/* -------------------------------------------------------------------------- */
/*                             Baby Growth Index                               */
/* -------------------------------------------------------------------------- */

/**
 * Israeli retail sizing ladder for 0–36 months.
 *
 * Sizes are the European cm-based codes used on Shilav labels. The height and
 * weight windows follow the WHO child growth standards, which the Israeli
 * Ministry of Health (טיפת חלב) adopted as its national growth curves — the
 * figures here are the boy/girl medians rounded to the nearest half unit, so
 * they describe an average Israeli baby rather than any individual one.
 */
export const SIZE_BANDS: SizeBand[] = [
  {
    code: '50-56',
    label: 'מידה 50-56 (יילוד עד חודשיים)',
    ageRange: { minMonths: 0, maxMonths: 2 },
    heightCmRange: { min: 46, max: 58 },
    weightKgRange: { min: 2.5, max: 4.5 },
    stage: 'newborn',
  },
  {
    code: '62',
    label: 'מידה 62 (2-4 חודשים)',
    ageRange: { minMonths: 2, maxMonths: 4 },
    heightCmRange: { min: 56, max: 63 },
    weightKgRange: { min: 4.5, max: 6.5 },
    stage: 'newborn',
  },
  {
    code: '68',
    label: 'מידה 68 (4-6 חודשים)',
    ageRange: { minMonths: 4, maxMonths: 6 },
    heightCmRange: { min: 62, max: 68 },
    weightKgRange: { min: 6, max: 8 },
    stage: 'early_infant',
  },
  {
    code: '74',
    label: 'מידה 74 (6-9 חודשים)',
    ageRange: { minMonths: 6, maxMonths: 9 },
    heightCmRange: { min: 67, max: 73 },
    weightKgRange: { min: 7, max: 9 },
    stage: 'sitting',
  },
  {
    code: '80',
    label: 'מידה 80 (9-12 חודשים)',
    ageRange: { minMonths: 9, maxMonths: 12 },
    heightCmRange: { min: 72, max: 79 },
    weightKgRange: { min: 8.5, max: 10.5 },
    stage: 'crawling',
  },
  {
    code: '86',
    label: 'מידה 86 (12-18 חודשים)',
    ageRange: { minMonths: 12, maxMonths: 18 },
    heightCmRange: { min: 78, max: 86 },
    weightKgRange: { min: 10, max: 12 },
    stage: 'first_steps',
  },
  {
    code: '92',
    label: 'מידה 92 (18-24 חודשים)',
    ageRange: { minMonths: 18, maxMonths: 24 },
    heightCmRange: { min: 85, max: 92 },
    weightKgRange: { min: 11.5, max: 13.5 },
    stage: 'toddler',
  },
  {
    code: '98',
    label: 'מידה 98 (24-36 חודשים)',
    ageRange: { minMonths: 24, maxMonths: 36 },
    heightCmRange: { min: 91, max: 99 },
    weightKgRange: { min: 13, max: 15.5 },
    stage: 'independent',
  },
];

const clampMonths = (months: number): number => Math.min(Math.max(months, 0), 35);

/** The size band that fits a baby of `ageMonths`. Ages past 36m clamp to the top band. */
export function getSizeBandForAge(ageMonths: number): SizeBand {
  const age = clampMonths(ageMonths);
  return (
    SIZE_BANDS.find(
      (band) => age >= band.ageRange.minMonths && age < band.ageRange.maxMonths,
    ) ?? SIZE_BANDS[SIZE_BANDS.length - 1]
  );
}

export const getSizeBand = (code: SizeCode): SizeBand =>
  SIZE_BANDS.find((band) => band.code === code) ?? SIZE_BANDS[0];

/** Position on the size ladder; -1 when the code is unknown. */
const sizeIndex = (code: SizeCode): number => SIZE_ORDER.indexOf(code);

/** The next size up, or `null` at the top of the ladder. */
export function getNextSize(code: SizeCode): SizeCode | null {
  const index = sizeIndex(code);
  return index >= 0 && index < SIZE_ORDER.length - 1 ? SIZE_ORDER[index + 1] : null;
}

/**
 * Baby Growth Index — where this baby sits on the sizing ladder and what to buy next.
 *
 * A size counts as "owned" when a past purchase of an apparel item offered that
 * size *and* the baby was in that size band at the time of purchase. When the
 * size that fits today is already covered, the recommendation moves a rung up:
 * there is no point selling a parent the size their drawer is already full of.
 */
export function getGrowthProjection(
  profile: CustomerProfile,
  history: PurchaseHistory[] = getPurchaseHistoryForCustomer(profile.id),
  catalog: Product[] = PRODUCTS,
): GrowthProjection {
  const currentBand = getSizeBandForAge(profile.babyAgeMonths);
  const currentSize = currentBand.code;
  const nextSize = getNextSize(currentSize);

  const ownedSizes: SizeCode[] = [];
  for (const purchase of history) {
    const product = catalog.find((candidate) => candidate.id === purchase.productId);
    if (!product || product.availableSizes.length === 0) continue;

    // The size the baby actually wore when that item was bought.
    const wornSize = getSizeBandForAge(purchase.babyAgeAtPurchase).code;
    if (product.availableSizes.includes(wornSize) && !ownedSizes.includes(wornSize)) {
      ownedSizes.push(wornSize);
    }
  }
  ownedSizes.sort((a, b) => sizeIndex(a) - sizeIndex(b));

  const currentSizeCovered = ownedSizes.includes(currentSize);
  const upgradedFromOwnedSize = currentSizeCovered && nextSize !== null;
  const recommendedSize = upgradedFromOwnedSize && nextSize ? nextSize : currentSize;

  const monthsToNextSize = nextSize
    ? Math.max(0, currentBand.ageRange.maxMonths - clampMonths(profile.babyAgeMonths))
    : null;

  const recommendedBand = getSizeBand(recommendedSize);
  const explanation = upgradedFromOwnedSize
    ? `לפי עקומות הגדילה, ${profile.babyName} לובש${profile.babyGender === 'girl' ? 'ת' : ''} כעת ${currentBand.label}. כבר רכשתם פריטים במידה הזו, ולכן הסל מותאם ל${recommendedBand.label} – המידה הבאה בתור.`
    : `לפי עקומות הגדילה, ${profile.babyName} נמצא${profile.babyGender === 'girl' ? 'ת' : ''} כעת ב${currentBand.label}${
        monthsToNextSize !== null && monthsToNextSize <= 2 && nextSize
          ? `, ובעוד כחודשיים צפוי מעבר ל${getSizeBand(nextSize).label}`
          : ''
      }.`;

  return {
    babyAgeMonths: profile.babyAgeMonths,
    currentSize,
    nextSize,
    monthsToNextSize,
    ownedSizes,
    recommendedSize,
    upgradedFromOwnedSize,
    explanation,
  };
}

/* -------------------------------------------------------------------------- */
/*                          Stage & season resolution                          */
/* -------------------------------------------------------------------------- */

export function getMilestoneRuleForAge(ageMonths: number): MilestoneRule {
  const age = clampMonths(ageMonths);
  return (
    MILESTONE_RULES.find(
      (rule) => age >= rule.ageRange.minMonths && age < rule.ageRange.maxMonths,
    ) ?? MILESTONE_RULES[MILESTONE_RULES.length - 1]
  );
}

/** The stage after `stage`, or `null` at the end of the 0–36m ladder. */
export function getUpcomingStage(ageMonths: number): MilestoneStage | null {
  const current = getMilestoneRuleForAge(ageMonths);
  const index = MILESTONE_RULES.findIndex((rule) => rule.id === current.id);
  return index >= 0 && index < MILESTONE_RULES.length - 1
    ? MILESTONE_RULES[index + 1].stage
    : null;
}

/**
 * Generic seasonality — the calendar season in Israel, not today's forecast.
 * This is a primary driver of the basket; live weather only ever adds secondary
 * suggestions on top.
 */
export function getCurrentSeason(date: Date = new Date()): Season {
  const month = date.getMonth() + 1; // 1–12
  if (month === 12 || month <= 3) return 'winter';
  if (month >= 6 && month <= 9) return 'summer';
  return 'transitional'; // אפריל–מאי, אוקטובר–נובמבר
}

/** How well a product's season fits the season we are buying for. */
function seasonFit(productSeason: Season, target: Season): 'match' | 'neutral' | 'clash' {
  if (productSeason === 'all_season' || target === 'all_season') return 'neutral';
  if (productSeason === target) return 'match';
  const opposites: Record<string, Season> = { winter: 'summer', summer: 'winter' };
  if (opposites[productSeason] === target) return 'clash';
  return 'neutral'; // transitional against winter/summer
}

/* -------------------------------------------------------------------------- */
/*                               Gap analysis                                  */
/* -------------------------------------------------------------------------- */

export interface CategoryGap {
  category: ProductCategory;
  /** Units the parent already owns in this category. */
  owned: number;
  /** Units the milestone rule expects. */
  required: number;
  /** Shortfall, always >= 1 for a real gap. */
  missing: number;
  /** True for `requiredCategories`, false for `optionalCategories`. */
  isRequired: boolean;
}

/** Units owned per category, counting only items bought for this baby. */
export function getOwnedQuantitiesByCategory(
  history: PurchaseHistory[],
  catalog: Product[] = PRODUCTS,
): Partial<Record<ProductCategory, number>> {
  const owned: Partial<Record<ProductCategory, number>> = {};
  for (const purchase of history) {
    const product = catalog.find((candidate) => candidate.id === purchase.productId);
    if (!product) continue;
    owned[product.category] = (owned[product.category] ?? 0) + purchase.quantity;
  }
  return owned;
}

/**
 * Subtract what the parent owns from the milestone checklist.
 * Required categories come first, then optional ones — the caller can slice.
 */
export function analyzeGaps(
  profile: CustomerProfile,
  history: PurchaseHistory[] = getPurchaseHistoryForCustomer(profile.id),
  catalog: Product[] = PRODUCTS,
): CategoryGap[] {
  const rule = getMilestoneRuleForAge(profile.babyAgeMonths);
  const owned = getOwnedQuantitiesByCategory(history, catalog);

  const toGap = (category: ProductCategory, isRequired: boolean): CategoryGap => {
    const required = isRequired ? rule.minimumQuantityPerCategory : 1;
    const ownedCount = owned[category] ?? 0;
    return {
      category,
      owned: ownedCount,
      required,
      missing: Math.max(0, required - ownedCount),
      isRequired,
    };
  };

  return [
    ...rule.requiredCategories.map((category) => toGap(category, true)),
    ...rule.optionalCategories.map((category) => toGap(category, false)),
  ].filter((gap) => gap.missing > 0);
}

/* -------------------------------------------------------------------------- */
/*                             Adaptive tone layer                             */
/* -------------------------------------------------------------------------- */

/**
 * Reason copy switches register with the baby's age.
 *
 * `clinical` (0–6m): parents of newborns are anxious and reading for reassurance,
 * so the copy is authoritative and developmental — thermoregulation, safe sleep,
 * sensory input. `warm` (6–36m): the crisis has passed and the parent is shopping,
 * so the copy is conversational, practical and a little playful.
 */
export type ReasonTone = 'clinical' | 'warm';

/** Age in months at which the copy switches register. */
export const TONE_SWITCH_MONTHS = 6;

export const getToneForAge = (ageMonths: number): ReasonTone =>
  ageMonths < TONE_SWITCH_MONTHS ? 'clinical' : 'warm';

const REASON_TEMPLATES: Record<ProductCategory, Record<ReasonTone, string>> = {
  bodysuit: {
    clinical:
      'בשלב זה חיוני לתמוך בחום הגוף ובוויסות חושי – שכבת בסיס צמודה מכותנה מפחיתה גירוי עורי ושומרת על טמפרטורה יציבה.',
    warm: 'בגד גוף הוא הפריט שנגמר הכי מהר בארון – שווה מארז נוסף לפני הכביסה הבאה.',
  },
  footie: {
    clinical:
      'ויסות חום הגוף בגיל זה עדיין חלקי. אוברול שלם עם כף רגל סגורה מצמצם איבוד חום דרך הגפיים בשעות השינה.',
    warm: 'אוברול אחד שפותר את כל הבוקר: לובשים, סוגרים רוכסן ויוצאים מהבית.',
  },
  crawling_pants: {
    clinical:
      'לקראת המעבר לתנועה עצמאית נדרשת שכבה מגנה על הברכיים, המונעת שפשוף בעור הרך בזחילה.',
    warm: 'הברכיים כבר על הרצפה כל היום – מכנסיים שנוחים לזחילה ושורדים את הכביסה.',
  },
  sleep_sack: {
    clinical:
      'הנחיות שינה בטוחה ממליצות על שק שינה במקום שמיכות רופפות: הוא שומר על חום גוף יציב ומונע כיסוי של הפנים.',
    warm: 'לילות רגועים יותר – שק שינה שנשאר במקום גם אחרי חמש התהפכויות.',
  },
  feeding_set: {
    clinical:
      'עם תחילת המזון המשלים מומלץ להשתמש בכלים ייעודיים רכים, המותאמים לחניכיים ולרפלקס הבליעה המתפתח.',
    warm: 'מתכוננים ללכלוך הראשון של הבטטה! ערכה שנשטפת בשנייה ומחזיקה מעמד מול כל טעימה חדשה.',
  },
  outerwear: {
    clinical:
      'בהיעדר ויסות חום מלא מומלצת הלבשה בשכבות – שכבת ביניים רכה מאפשרת התאמה מהירה למעברי טמפרטורה.',
    warm: 'יוצאים לגן שעשועים? שכבה חמימה שקלה מספיק כדי לא להפריע לטיפוס.',
  },
  hat_accessories: {
    clinical:
      'הראש הוא אזור מרכזי לאיבוד חום בינקות, ולכן כיסוי ראש מותאם חיוני בכל יציאה מהבית.',
    warm: 'כובע שנשאר על הראש – בזכות רצועה שהפעוט לא מצליח לפרק לבד.',
  },
  socks_shoes: {
    clinical:
      'כף הרגל בגיל זה גמישה ורגישה. הנעלה מותאמת מספקת יציבות מבלי להגביל את התפתחות שרירי כף הרגל.',
    warm: 'רגליים קטנות בתנועה מתמדת – משהו שנשאר על הרגל ולא מחליק.',
  },
  bath_care: {
    clinical:
      'לאחר הרחצה קצב איבוד החום מהיר – עטיפה מיידית במגבת סופגת שומרת על חום הגוף ומונעת צינון.',
    warm: 'הרגע הכי חמוד ביום: יוצאים מהאמבט ישר לתוך מגבת עם אוזניים.',
  },
  bedding: {
    clinical:
      'מצע מוסלין נושם תומך בהחתלה יציבה, המסייעת לתינוק להירגע ולהאריך את משך השינה הרצופה.',
    warm: 'שמיכת מוסלין היא הפריט הכי רב-שימושי בתיק – הצללה, כיסוי ומשטח החתלה מאולתר.',
  },
  toys_development: {
    clinical:
      'גירוי חושי מדוד – מרקמים וניגודיות צבע – תומך בהתפתחות הראייה והמוטוריקה בחודשים הראשונים.',
    warm: 'משחק שמעודד לשבת, לתפוס ולהעביר מיד ליד – ומציל גם נסיעות ארוכות.',
  },
  first_walk: {
    clinical:
      'בשלב הצעדים הראשונים מומלצת סוליה גמישה, המאפשרת לכף הרגל לחוש את המשטח ולפתח שיווי משקל.',
    warm: 'הצעד הראשון ממש מעבר לפינה – נעל רכה שמלווה אותו בלי להפריע.',
  },
};

/**
 * Warm copy that would misfire on an older toddler. Applied from 18 months, where
 * "the first taste of sweet potato" is a year out of date.
 */
const LATE_TODDLER_OVERRIDES: Partial<Record<ProductCategory, string>> = {
  feeding_set:
    'הפעוט מתעקש לאכול לבד? כלים בגודל הנכון הופכים את הארוחה להרבה פחות מלחמה.',
  toys_development: 'משחק שמעסיק לאורך זמן ומפתח מוטוריקה – גם בבית וגם בנסיעה.',
};

/** Age from which `LATE_TODDLER_OVERRIDES` replaces the standard warm copy. */
const LATE_TODDLER_MONTHS = 18;

interface ReasonContext {
  product: Product;
  tone: ReasonTone;
  trigger: BasketItem['trigger'];
  gap?: CategoryGap;
  growth: GrowthProjection;
  season: Season;
  /** Degrees below the 7-day average, for weather-driven suggestions. */
  temperatureDropC?: number;
  city?: string;
}

/** Build the Hebrew, customer-facing reason for one basket line. */
export function buildReason(context: ReasonContext): string {
  const { product, tone, trigger, gap, growth, temperatureDropC, city } = context;
  const override =
    tone === 'warm' && growth.babyAgeMonths >= LATE_TODDLER_MONTHS
      ? LATE_TODDLER_OVERRIDES[product.category]
      : undefined;
  const base = override ?? REASON_TEMPLATES[product.category][tone];
  const sizeLabel = getSizeBand(growth.recommendedSize).label;
  const supportsSize = product.availableSizes.includes(growth.recommendedSize);

  const clauses: string[] = [base];

  if (trigger === 'milestone_gap' && gap) {
    clauses.push(
      tone === 'clinical'
        ? `הפריט משלים פער בקטגוריית ${CATEGORY_LABELS[gap.category]} עבור השלב הנוכחי.`
        : `עדיין אין אצלכם ${CATEGORY_LABELS[gap.category]} שמתאימים לשלב הזה.`,
    );
  }

  if (trigger === 'size_upgrade' || (supportsSize && growth.upgradedFromOwnedSize)) {
    clauses.push(
      tone === 'clinical'
        ? `המידה הנוכחית כבר מכוסה ברכישות קודמות, ולכן ההמלצה היא ${sizeLabel}.`
        : `כבר קניתם במידה הקודמת – הפעם עולים ל${sizeLabel}, לפני שהנוכחית נהיית קטנה.`,
    );
  }

  if (trigger === 'weather' && temperatureDropC !== undefined) {
    const drop = Math.round(temperatureDropC);
    clauses.push(
      tone === 'clinical'
        ? `נרשמה ירידה של כ-${drop} מעלות מהממוצע ב${city ?? 'אזור מגוריכם'}; שכבה נוספת מומלצת עד להתייצבות מזג האוויר.`
        : `צנח פתאום ב-${drop} מעלות ב${city ?? 'אזור שלכם'} – שווה שכבה נוספת בהישג יד.`,
    );
  }

  if (trigger === 'seasonal') {
    clauses.push(
      tone === 'clinical'
        ? 'הפריט תואם את טווח הגיל הנוכחי ואת העונה, ומשלים את מלאי הבסיס בארון.'
        : 'מתאים לעונה ולגיל הנוכחי – השלמה טבעית לארון.',
    );
  }

  if (trigger === 'bestseller') {
    clauses.push(
      tone === 'clinical'
        ? 'פריט מומלץ ונרכש בהיקף רחב על ידי הורים בשלב התפתחותי זהה.'
        : 'אחד הפריטים הכי נמכרים אצל הורים בשלב הזה.',
    );
  }

  return clauses.join(' ');
}

/* -------------------------------------------------------------------------- */
/*                                  Scoring                                    */
/* -------------------------------------------------------------------------- */

/** How far ahead of the baby's current age the engine is willing to buy. */
const LOOKAHEAD_MONTHS = 3;

/** Weights are relative; milestone gaps must always outrank everything else. */
const WEIGHTS = {
  requiredGap: 60,
  optionalGap: 25,
  seasonMatch: 18,
  seasonNeutral: 6,
  sizeFit: 14,
  buysAhead: 8,
  preferredCategory: 10,
  bestseller: 6,
  discount: 4,
} as const;

const fitsAgeWindow = (product: Product, ageMonths: number): boolean =>
  product.ageRange.minMonths < ageMonths + LOOKAHEAD_MONTHS &&
  product.ageRange.maxMonths > ageMonths;

const fitsGender = (product: Product, babyGender: Product['gender']): boolean =>
  product.gender === 'unisex' || babyGender === 'unisex' || product.gender === babyGender;

interface ScoredCandidate {
  product: Product;
  score: number;
  gap?: CategoryGap;
  trigger: BasketItem['trigger'];
}

function scoreCandidate(
  product: Product,
  profile: CustomerProfile,
  growth: GrowthProjection,
  season: Season,
  gapsByCategory: Map<ProductCategory, CategoryGap>,
): ScoredCandidate {
  const gap = gapsByCategory.get(product.category);
  let score = 0;

  if (gap) {
    const rule = getMilestoneRuleForAge(profile.babyAgeMonths);
    score += gap.isRequired
      ? WEIGHTS.requiredGap + rule.priority * 2
      : WEIGHTS.optionalGap;
  }

  const fit = seasonFit(product.season, season);
  score += fit === 'match' ? WEIGHTS.seasonMatch : WEIGHTS.seasonNeutral;

  const isApparel = product.availableSizes.length > 0;
  const supportsSize = isApparel && product.availableSizes.includes(growth.recommendedSize);
  if (supportsSize) score += WEIGHTS.sizeFit;

  if (product.ageRange.maxMonths > profile.babyAgeMonths + LOOKAHEAD_MONTHS) {
    score += WEIGHTS.buysAhead;
  }
  if (profile.preferredCategories.includes(product.category)) {
    score += WEIGHTS.preferredCategory;
  }
  if (product.isBestseller) score += WEIGHTS.bestseller;
  if (product.originalPrice) score += WEIGHTS.discount;
  score += Math.round((product.rating - 4) * 10);

  const trigger: BasketItem['trigger'] = gap
    ? 'milestone_gap'
    : supportsSize && growth.upgradedFromOwnedSize
      ? 'size_upgrade'
      : product.isBestseller
        ? 'bestseller'
        : 'seasonal';

  return { product, score, gap, trigger };
}

/* -------------------------------------------------------------------------- */
/*                             Basket generation                               */
/* -------------------------------------------------------------------------- */

export interface GenerateBasketOptions {
  catalog?: Product[];
  history?: PurchaseHistory[];
  /** Reference date for seasonality. Injectable to keep output deterministic. */
  now?: Date;
  /** Live reading for the customer's city; drives secondary suggestions only. */
  weather?: { temperatureC: number; averageTemperatureC: number; city: string };
  /** Hard cap on primary items. */
  maxItems?: number;
  /** Hard cap on weather-driven secondary suggestions. */
  maxSecondary?: number;
}

/** Temperature drop below the 7-day average that counts as an anomaly, in °C. */
export const COLD_SNAP_THRESHOLD_C = 5;

const roundAgorot = (value: number): number => Math.round(value * 100) / 100;

function toBasketItem(
  candidate: ScoredCandidate,
  profile: CustomerProfile,
  growth: GrowthProjection,
  season: Season,
  extra: { temperatureDropC?: number; city?: string } = {},
): BasketItem {
  const tone = getToneForAge(profile.babyAgeMonths);
  const isApparel = candidate.product.availableSizes.length > 0;
  const recommendedSize = isApparel
    ? candidate.product.availableSizes.includes(growth.recommendedSize)
      ? growth.recommendedSize
      : nearestAvailableSize(candidate.product, growth.recommendedSize)
    : null;

  return {
    product: candidate.product,
    quantity: candidate.gap ? Math.min(candidate.gap.missing, 2) : 1,
    score: candidate.score,
    reason: buildReason({
      product: candidate.product,
      tone,
      trigger: candidate.trigger,
      gap: candidate.gap,
      growth,
      season,
      ...extra,
    }),
    closesGap: candidate.gap?.category ?? null,
    trigger: candidate.trigger,
    recommendedSize,
    selectedSize: recommendedSize,
    parentAdjusted: false,
  };
}

/** Closest size the SKU actually stocks, measured on the size ladder. */
function nearestAvailableSize(product: Product, target: SizeCode): SizeCode | null {
  if (product.availableSizes.length === 0) return null;
  const targetIndex = SIZE_ORDER.indexOf(target);
  return [...product.availableSizes].sort(
    (a, b) =>
      Math.abs(SIZE_ORDER.indexOf(a) - targetIndex) -
        Math.abs(SIZE_ORDER.indexOf(b) - targetIndex) ||
      SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b),
  )[0];
}

/**
 * Build a tailored basket for one customer.
 *
 * Primary items come from milestone gaps and generic seasonality. A weather
 * anomaly never enters `items`; it can only add to `secondarySuggestions`.
 */
export function generateBasket(
  profile: CustomerProfile,
  options: GenerateBasketOptions = {},
): GeneratedBasket {
  const {
    catalog = PRODUCTS,
    history = PURCHASE_HISTORY.filter((purchase) => purchase.customerId === profile.id),
    now = new Date(),
    weather,
    maxItems = 6,
    maxSecondary = 2,
  } = options;

  const season = getCurrentSeason(now);
  const rule = getMilestoneRuleForAge(profile.babyAgeMonths);
  const growth = getGrowthProjection(profile, history, catalog);
  const gaps = analyzeGaps(profile, history, catalog);
  const gapsByCategory = new Map(gaps.map((gap) => [gap.category, gap]));
  const ownedProductIds = new Set(history.map((purchase) => purchase.productId));

  const eligible = catalog.filter(
    (product) =>
      product.stock > 0 &&
      !ownedProductIds.has(product.id) &&
      fitsAgeWindow(product, profile.babyAgeMonths) &&
      fitsGender(product, profile.babyGender) &&
      seasonFit(product.season, season) !== 'clash',
  );

  const scored = eligible
    .map((product) => scoreCandidate(product, profile, growth, season, gapsByCategory))
    .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));

  // One SKU per category keeps the basket legible; budget is a soft ceiling that
  // never blocks a required milestone gap.
  const budgetCeiling = profile.averageOrderValue * 1.3;
  const usedCategories = new Set<ProductCategory>();
  const chosen: ScoredCandidate[] = [];
  let runningTotal = 0;

  for (const candidate of scored) {
    if (chosen.length >= maxItems) break;
    if (usedCategories.has(candidate.product.category)) continue;

    const quantity = candidate.gap ? Math.min(candidate.gap.missing, 2) : 1;
    const lineTotal = candidate.product.price * quantity;
    const isRequiredGap = candidate.gap?.isRequired ?? false;

    if (!isRequiredGap && runningTotal + lineTotal > budgetCeiling && chosen.length >= 3) {
      continue;
    }

    chosen.push(candidate);
    usedCategories.add(candidate.product.category);
    runningTotal += lineTotal;
  }

  const items = chosen.map((candidate) =>
    toBasketItem(candidate, profile, growth, season),
  );

  /* --- Secondary layer: weather anomalies, strictly subordinate to the above --- */
  const secondarySuggestions: BasketItem[] = [];
  const temperatureDropC = weather
    ? weather.averageTemperatureC - weather.temperatureC
    : 0;

  if (weather && temperatureDropC >= COLD_SNAP_THRESHOLD_C) {
    const alreadyChosen = new Set(items.map((item) => item.product.id));
    const warmCandidates = catalog
      .filter(
        (product) =>
          product.stock > 0 &&
          !alreadyChosen.has(product.id) &&
          !ownedProductIds.has(product.id) &&
          fitsAgeWindow(product, profile.babyAgeMonths) &&
          fitsGender(product, profile.babyGender) &&
          (product.season === 'winter' || product.season === 'transitional') &&
          ['outerwear', 'sleep_sack', 'footie', 'hat_accessories'].includes(
            product.category,
          ),
      )
      .map((product) => scoreCandidate(product, profile, growth, 'winter', gapsByCategory))
      .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));

    const usedSecondaryCategories = new Set<ProductCategory>();
    for (const candidate of warmCandidates) {
      if (secondarySuggestions.length >= maxSecondary) break;
      if (usedSecondaryCategories.has(candidate.product.category)) continue;
      usedSecondaryCategories.add(candidate.product.category);
      secondarySuggestions.push(
        toBasketItem(
          { ...candidate, trigger: 'weather' },
          profile,
          growth,
          season,
          { temperatureDropC, city: weather.city },
        ),
      );
    }
  }

  const basket: GeneratedBasket = {
    id: `basket-${profile.id}-${profile.babyAgeMonths}m`,
    customerId: profile.id,
    generatedAt: now.toISOString(),
    currentStage: rule.stage,
    upcomingStage: getUpcomingStage(profile.babyAgeMonths),
    babyAgeMonths: profile.babyAgeMonths,
    season,
    items,
    secondarySuggestions,
    growth,
    totalPrice: 0,
    totalSavings: 0,
    gapCategories: gaps.filter((gap) => gap.isRequired).map((gap) => gap.category),
    summary: '',
    headline: `הסל של ${profile.babyName} – ${STAGE_LABELS[rule.stage]}`,
  };

  return withRecalculatedTotals({ ...basket, summary: buildSummary(basket, profile, rule) });
}

/** Recompute price fields from the current line items. Pure. */
export function withRecalculatedTotals(basket: GeneratedBasket): GeneratedBasket {
  const totalPrice = basket.items.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0,
  );
  const totalSavings = basket.items.reduce(
    (sum, item) =>
      sum +
      (item.product.originalPrice
        ? (item.product.originalPrice - item.product.price) * item.quantity
        : 0),
    0,
  );
  return {
    ...basket,
    totalPrice: roundAgorot(totalPrice),
    totalSavings: roundAgorot(totalSavings),
  };
}

function buildSummary(
  basket: GeneratedBasket,
  profile: CustomerProfile,
  rule: MilestoneRule,
): string {
  const tone = getToneForAge(profile.babyAgeMonths);
  const gapText = basket.gapCategories.length
    ? basket.gapCategories.map((category) => CATEGORY_LABELS[category]).join(', ')
    : 'אין פערים פתוחים';
  const sizeLabel = getSizeBand(basket.growth.recommendedSize).label;

  const opening =
    tone === 'clinical'
      ? `${profile.babyName} בן ${profile.babyAgeMonths} חודשים ונמצא בשלב ${rule.title}.`
      : `${profile.babyName} כבר בן ${profile.babyAgeMonths} חודשים – ואנחנו בשלב ${rule.title}!`;

  return [
    opening,
    `הסל נבנה לפי ${sizeLabel} ולפי עונת ה${basket.season === 'winter' ? 'חורף' : basket.season === 'summer' ? 'קיץ' : 'מעבר'}.`,
    `הפערים שזוהו: ${gapText}.`,
    rule.parentingTip,
  ].join(' ');
}

/* -------------------------------------------------------------------------- */
/*                          Basket manipulation helpers                        */
/* -------------------------------------------------------------------------- */

const isSizeDependent = (item: BasketItem): boolean =>
  item.product.availableSizes.length > 0;

/**
 * Bulk-apply a parent-selected size to every size-dependent line in the basket.
 *
 * Feeding sets, toys, bath and bedding items carry no cm sizing and are left
 * untouched. A SKU that does not stock `newSize` falls back to the closest size
 * it does stock, so the basket never ends up with an unorderable line.
 * Pure: returns a new basket, mutating nothing.
 */
export function updateBasketSizes(
  basket: GeneratedBasket,
  newSize: SizeCode,
): GeneratedBasket {
  const applySize = (item: BasketItem): BasketItem => {
    if (!isSizeDependent(item)) return item;
    const selectedSize = item.product.availableSizes.includes(newSize)
      ? newSize
      : nearestAvailableSize(item.product, newSize);
    if (selectedSize === item.selectedSize) return { ...item, parentAdjusted: true };
    return { ...item, selectedSize, parentAdjusted: true };
  };

  return withRecalculatedTotals({
    ...basket,
    items: basket.items.map(applySize),
    secondarySuggestions: basket.secondarySuggestions.map(applySize),
  });
}

/* ------------------------ Natural-language modification ------------------- */

/** Attributes the parser understands, and the Hebrew stems that signal them. */
const ATTRIBUTE_LEXICON: Array<{ attribute: string; stems: string[] }> = [
  { attribute: 'short', stems: ['קצר'] },
  { attribute: 'long', stems: ['ארוך', 'ארוכ'] },
  { attribute: 'summer', stems: ['קיץ', 'קיצי'] },
  { attribute: 'winter', stems: ['חורף', 'חמים', 'מחמם'] },
  { attribute: 'organic', stems: ['אורגני'] },
  { attribute: 'cotton', stems: ['כותנה'] },
];

/** Hebrew stems that identify a product category. Longest stem wins. */
const CATEGORY_LEXICON: Array<{ category: ProductCategory; stems: string[] }> = [
  { category: 'bodysuit', stems: ['בגד גוף', 'בגדי גוף'] },
  { category: 'footie', stems: ['אוברול', 'סרבל', 'רגליות'] },
  { category: 'crawling_pants', stems: ['מכנס', 'טרנינג', 'לגינגס'] },
  { category: 'sleep_sack', stems: ['שק שינה', 'שקי שינה'] },
  { category: 'feeding_set', stems: ['האכלה', 'גמילה', 'סינר', 'כוס', 'כלי אוכל'] },
  { category: 'outerwear', stems: ['מעיל', "ז'קט", 'סוודר', 'הלבשה עליונה'] },
  { category: 'hat_accessories', stems: ['כובע'] },
  { category: 'socks_shoes', stems: ['גרב'] },
  { category: 'first_walk', stems: ['נעל'] },
  { category: 'bath_care', stems: ['מגבת', 'רחצה'] },
  { category: 'bedding', stems: ['שמיכ', 'מצע', 'חיתול'] },
  { category: 'toys_development', stems: ['צעצוע', 'קובי'] },
];

const REJECTION_MARKERS = [
  'לא רוצה',
  'לא רוצים',
  'לא צריך',
  'לא צריכה',
  'לא מעוניין',
  'לא מתאים',
  'להוריד',
  'תוריד',
  'תורידי',
  'להסיר',
  'בלי',
  'מיותר',
];

const PREFERENCE_MARKERS = [
  'מעדיפה',
  'מעדיף',
  'במקום',
  'תוסיף',
  'תוסיפי',
  'אשמח',
  'עדיף',
  'רוצה דווקא',
];

/** Attribute pairs the parser can flip when only one side is stated. */
const OPPOSITE_ATTRIBUTE: Record<string, string> = {
  short: 'long',
  long: 'short',
  summer: 'winter',
  winter: 'summer',
};

/**
 * Hebrew final letters (ך ם ן ף ץ) appear only at the end of a word, so the stem
 * "חורף" never substring-matches "חורפיים". Folding finals to their base form
 * lets one stem cover every inflection of a word.
 */
const foldFinals = (text: string): string =>
  text
    .replace(/\u05da/g, '\u05db')
    .replace(/\u05dd/g, '\u05de')
    .replace(/\u05df/g, '\u05e0')
    .replace(/\u05e3/g, '\u05e4')
    .replace(/\u05e5/g, '\u05e6');

const containsAny = (text: string, needles: string[]): boolean => {
  const haystack = foldFinals(text);
  return needles.some((needle) => haystack.includes(foldFinals(needle)));
};

const attributesIn = (text: string): string[] =>
  ATTRIBUTE_LEXICON.filter((entry) => containsAny(text, entry.stems)).map(
    (entry) => entry.attribute,
  );

const categoriesIn = (text: string): ProductCategory[] =>
  CATEGORY_LEXICON.filter((entry) => containsAny(text, entry.stems)).map(
    (entry) => entry.category,
  );

/** Does a product carry this attribute? */
function productHasAttribute(product: Product, attribute: string): boolean {
  switch (attribute) {
    case 'short':
    case 'long':
      return product.garmentLength === attribute;
    case 'summer':
    case 'winter':
      return product.season === attribute;
    default: {
      const entry = ATTRIBUTE_LEXICON.find((item) => item.attribute === attribute);
      if (!entry) return false;
      const haystack = `${product.name} ${product.description} ${product.tags.join(' ')}`;
      return containsAny(haystack, entry.stems);
    }
  }
}

/**
 * Parse a short Hebrew instruction into rejected/preferred attributes.
 *
 * Deliberately rule-based rather than model-backed: the vocabulary of basket
 * edits is small and closed, and a lexicon keeps the engine pure, offline and
 * deterministic. Clauses are split on commas and on "אבל"/"אלא", then each
 * clause is classified as a rejection or a preference by its marker phrase.
 */
export function parseBasketInstruction(query: string): ParsedIntent {
  const normalized = query.replace(/[.!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const clauses = normalized
    .split(/,| אבל | אלא /)
    .map((clause) => clause.trim())
    .filter(Boolean);

  const rejected = new Set<string>();
  const preferred = new Set<string>();
  const categories = new Set<ProductCategory>();
  let sawPreferenceMarker = false;

  for (const clause of clauses) {
    categoriesIn(clause).forEach((category) => categories.add(category));
    const attributes = attributesIn(clause);
    const isRejection = containsAny(clause, REJECTION_MARKERS);
    const isPreference = containsAny(clause, PREFERENCE_MARKERS);
    if (isPreference) sawPreferenceMarker = true;

    if (isRejection && !isPreference) {
      attributes.forEach((attribute) => rejected.add(attribute));
    } else if (isPreference && !isRejection) {
      attributes.forEach((attribute) => preferred.add(attribute));
    } else if (isRejection && isPreference) {
      // "לא רוצה קצר אלא ארוך" inside one clause: first attribute is the reject.
      attributes.forEach((attribute, index) =>
        index === 0 ? rejected.add(attribute) : preferred.add(attribute),
      );
    }
  }

  // A stated preference implies rejecting its opposite, and vice versa.
  for (const attribute of preferred) {
    const opposite = OPPOSITE_ATTRIBUTE[attribute];
    if (opposite && !preferred.has(opposite)) rejected.add(opposite);
  }
  if (preferred.size === 0 && sawPreferenceMarker) {
    for (const attribute of rejected) {
      const opposite = OPPOSITE_ATTRIBUTE[attribute];
      if (opposite && !rejected.has(opposite)) preferred.add(opposite);
    }
  }
  for (const attribute of preferred) rejected.delete(attribute);

  return {
    rejected: [...rejected],
    preferred: [...preferred],
    categories: [...categories],
    removeOnly: preferred.size === 0,
  };
}

/** Pick the best catalog replacement for an item the parent rejected. */
function findReplacement(
  removed: BasketItem,
  intent: ParsedIntent,
  basket: GeneratedBasket,
  catalog: Product[],
): Product | undefined {
  const inBasket = new Set([
    ...basket.items.map((item) => item.product.id),
    ...basket.secondarySuggestions.map((item) => item.product.id),
  ]);

  return catalog
    .filter(
      (product) =>
        product.id !== removed.product.id &&
        product.category === removed.product.category &&
        product.stock > 0 &&
        !inBasket.has(product.id) &&
        fitsAgeWindow(product, basket.babyAgeMonths) &&
        intent.preferred.every((attribute) => productHasAttribute(product, attribute)) &&
        !intent.rejected.some((attribute) => productHasAttribute(product, attribute)),
    )
    .sort((a, b) => {
      const seasonRank = (product: Product) =>
        seasonFit(product.season, basket.season) === 'match' ? 0 : 1;
      return (
        seasonRank(a) - seasonRank(b) ||
        b.rating - a.rating ||
        a.id.localeCompare(b.id)
      );
    })[0];
}

/**
 * Apply a free-text Hebrew instruction to a basket.
 *
 * Example: "לא רוצה מכנסיים קצרים לקיץ, מעדיפה ארוכים" removes the short summer
 * pants and swaps in the best long-legged alternative from the same category.
 * Pure: returns a new basket alongside a description of every change.
 */
export function modifyBasketWithNaturalLanguage(
  basket: GeneratedBasket,
  query: string,
  catalog: Product[] = PRODUCTS,
): BasketModificationResult {
  const intent = parseBasketInstruction(query);
  const modifications: BasketModification[] = [];

  const inTargetCategory = (item: BasketItem) =>
    intent.categories.length === 0 || intent.categories.includes(item.product.category);

  const categoryScoped = basket.items.filter(inTargetCategory);

  // Prefer lines that match every rejected attribute; fall back to any match.
  let doomed = categoryScoped.filter(
    (item) =>
      intent.rejected.length > 0 &&
      intent.rejected.every((attribute) => productHasAttribute(item.product, attribute)),
  );
  if (doomed.length === 0 && intent.rejected.length > 0) {
    doomed = categoryScoped.filter((item) =>
      intent.rejected.some((attribute) => productHasAttribute(item.product, attribute)),
    );
  }
  // "תורידי את המכנסיים" — a category with no attributes at all.
  if (doomed.length === 0 && intent.rejected.length === 0 && intent.categories.length > 0) {
    doomed = categoryScoped;
  }

  const doomedIds = new Set(doomed.map((item) => item.product.id));
  let items = basket.items.filter((item) => !doomedIds.has(item.product.id));

  for (const removed of doomed) {
    const replacement = intent.removeOnly
      ? undefined
      : findReplacement(removed, intent, { ...basket, items }, catalog);

    if (!replacement) {
      modifications.push({
        action: 'removed',
        removedProductId: removed.product.id,
        explanation: `הסרנו מהסל: ${removed.product.name}.`,
      });
      continue;
    }

    const tone = getToneForAge(basket.babyAgeMonths);
    const selectedSize =
      replacement.availableSizes.length > 0
        ? nearestAvailableSize(replacement, basket.growth.recommendedSize)
        : null;

    items = [
      ...items,
      {
        product: replacement,
        quantity: removed.quantity,
        score: removed.score,
        reason: `${buildReason({
          product: replacement,
          tone,
          trigger: removed.trigger,
          gap: undefined,
          growth: basket.growth,
          season: basket.season,
        })} החלפנו לבקשתכם את «${removed.product.name}».`,
        closesGap: removed.closesGap,
        trigger: removed.trigger,
        recommendedSize: selectedSize,
        selectedSize,
        parentAdjusted: true,
      },
    ];

    modifications.push({
      action: 'swapped',
      removedProductId: removed.product.id,
      addedProductId: replacement.id,
      explanation: `החלפנו «${removed.product.name}» ב«${replacement.name}».`,
    });
  }

  const understood = modifications.length > 0;
  const message = understood
    ? `עדכנו את הסל: ${modifications.map((change) => change.explanation).join(' ')}`
    : intent.rejected.length === 0 && intent.categories.length === 0
      ? 'לא הצלחנו להבין את הבקשה. אפשר לנסח למשל: "לא רוצה מכנסיים קצרים, מעדיפה ארוכים".'
      : 'לא נמצאו בסל פריטים שתואמים לבקשה, ולכן הסל נשאר ללא שינוי.';

  return {
    basket: understood ? withRecalculatedTotals({ ...basket, items }) : basket,
    modifications,
    intent,
    understood,
    message,
  };
}
