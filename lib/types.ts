/**
 * Personalized Milestone Basket Engine — shared type definitions.
 *
 * Types only: no logic and no data live in this file.
 * Ages are always integers in months. Prices are plain numbers in ILS (₪).
 */

/** Product families in the Shilav catalog. Hebrew labels live in `CATEGORY_LABELS`. */
export type ProductCategory =
  | 'bodysuit' // בגדי גוף
  | 'footie' // אוברולים / רגליות
  | 'crawling_pants' // מכנסי זחילה
  | 'sleep_sack' // שקי שינה
  | 'feeding_set' // סטים לגמילה והאכלה
  | 'outerwear' // הלבשה עליונה
  | 'hat_accessories' // כובעים ואביזרים
  | 'socks_shoes' // גרביים ונעליים
  | 'bath_care' // רחצה וטיפוח
  | 'bedding' // מצעים ושמיכות
  | 'toys_development' // צעצועי התפתחות
  | 'first_walk'; // צעדים ראשונים

/** Which part of the year an item is meant for. `all_season` fits any weather. */
export type Season = 'winter' | 'summer' | 'transitional' | 'all_season';

/** Developmental stages, 0–36 months. */
export type MilestoneStage =
  | 'newborn' // 0–3m   — יילוד
  | 'early_infant' // 3–6m   — תינוק צעיר
  | 'sitting' // 6–9m   — ישיבה
  | 'crawling' // 9–12m  — זחילה
  | 'first_steps' // 12–18m — צעדים ראשונים
  | 'toddler' // 18–24m — פעוט
  | 'independent'; // 24–36m — עצמאות

/** An age window in months, inclusive of `minMonths`, exclusive of `maxMonths`. */
export interface AgeRange {
  minMonths: number;
  maxMonths: number;
}

export type Gender = 'boy' | 'girl' | 'unisex';

/**
 * Israeli retail size codes for baby clothing (European cm-based sizing, as used
 * on Shilav labels). `50-56` covers newborns; `98` runs to the end of month 36.
 */
export type SizeCode = '50-56' | '62' | '68' | '74' | '80' | '86' | '92' | '98';

/** Ordered smallest to largest — the growth ladder the engine climbs. */
export const SIZE_ORDER: SizeCode[] = ['50-56', '62', '68', '74', '80', '86', '92', '98'];

/** One rung of the Baby Growth Index: a size and the babies it fits. */
export interface SizeBand {
  code: SizeCode;
  /** Hebrew display label, e.g. "מידה 68 (3-6 חודשים)". */
  label: string;
  /** Age window this size normally fits. */
  ageRange: AgeRange;
  /** Expected height range in cm at this size. */
  heightCmRange: { min: number; max: number };
  /** Expected weight range in kg at this size. */
  weightKgRange: { min: number; max: number };
  stage: MilestoneStage;
}

/** Where a baby sits on the growth ladder, and where they are heading next. */
export interface GrowthProjection {
  babyAgeMonths: number;
  /** Size that fits the baby's age today. */
  currentSize: SizeCode;
  /** The next size up; `null` once the baby is past the 0–36m ladder. */
  nextSize: SizeCode | null;
  /** Whole months until the baby is expected to move up a size. */
  monthsToNextSize: number | null;
  /** Sizes already covered by past purchases. */
  ownedSizes: SizeCode[];
  /**
   * The size the engine actually recommends. Equals `nextSize` when the current
   * size is already covered by past purchases, otherwise `currentSize`.
   */
  recommendedSize: SizeCode;
  /** True when the recommendation was bumped a rung because the current size is covered. */
  upgradedFromOwnedSize: boolean;
  /** Hebrew explanation of the projection, shown to the parent. */
  explanation: string;
}

/** A single item in the Shilav catalog. */
export interface Product {
  id: string;
  /** Hebrew display name, e.g. "בגד גוף כותנה אורגנית". */
  name: string;
  /** Short Hebrew marketing description. */
  description: string;
  category: ProductCategory;
  /** Age window this product is designed for. */
  ageRange: AgeRange;
  season: Season;
  gender: Gender;
  /** Retail price in ILS. */
  price: number;
  /** Original price when the item is discounted; `undefined` when at full price. */
  originalPrice?: number;
  /** Units currently on hand. */
  stock: number;
  /** Stock level above which the SKU counts as surplus for the anomaly detector. */
  surplusThreshold: number;
  /** Hebrew size label, e.g. "3-6 חודשים" or "מידה 80". */
  sizeLabel: string;
  /**
   * Size codes this SKU is stocked in. Empty for non-apparel items
   * (feeding sets, toys, bath care), which the size logic skips.
   */
  availableSizes: SizeCode[];
  /**
   * Sleeve length for tops, leg length for bottoms. Drives natural-language
   * swaps like "מעדיפה ארוכים". `undefined` when the notion does not apply.
   */
  garmentLength?: 'short' | 'long';
  /** Hebrew free-text tags used for scoring and search, e.g. "כותנה אורגנית". */
  tags: string[];
  imageUrl: string;
  /** Average customer rating, 0–5. */
  rating: number;
  /** True for items Shilav wants to push regardless of gaps. */
  isBestseller: boolean;
}

/** A parent and their baby — the input to the basket engine. */
export interface CustomerProfile {
  id: string;
  /** Hebrew full name of the parent. */
  name: string;
  email: string;
  phone: string;
  /** Hebrew city name — drives the weather/cold-snap signal. */
  city: string;
  /** Hebrew baby name. */
  babyName: string;
  /** Baby's current age in whole months (0–36). */
  babyAgeMonths: number;
  babyGender: Gender;
  /** ISO date (YYYY-MM-DD) of the baby's birth. */
  babyBirthDate: string;
  /** Categories this customer has shown a preference for. */
  preferredCategories: ProductCategory[];
  /** Typical spend per order in ILS — used to size the basket. */
  averageOrderValue: number;
  /** Loyalty club tier; `null` for non-members. */
  loyaltyTier: 'silver' | 'gold' | 'platinum' | null;
  /** ISO date of the customer's most recent order. */
  lastPurchaseDate: string;
  /** True when the parent opted in to personalized campaigns. */
  marketingOptIn: boolean;
}

/** One past order line, linking a customer to a product they already own. */
export interface PurchaseHistory {
  id: string;
  customerId: string;
  productId: string;
  /** ISO date (YYYY-MM-DD) of the purchase. */
  purchaseDate: string;
  quantity: number;
  /** Price actually paid per unit in ILS, after any discount. */
  pricePaid: number;
  /** The baby's age in months at the time of purchase. */
  babyAgeAtPurchase: number;
  channel: 'online' | 'store' | 'app';
}

/** A developmental stage expanded into the categories a baby needs during it. */
export interface MilestoneRule {
  id: string;
  stage: MilestoneStage;
  /** Hebrew stage title, e.g. "שלב הזחילה". */
  title: string;
  /** Hebrew explanation of what changes for the baby at this stage. */
  description: string;
  ageRange: AgeRange;
  /** Categories a baby at this stage should own — the checklist. */
  requiredCategories: ProductCategory[];
  /** Nice-to-have categories, added only when budget allows. */
  optionalCategories: ProductCategory[];
  /** Minimum units of each required category considered "covered". */
  minimumQuantityPerCategory: number;
  /** Relative importance of closing this stage's gaps, 1 (low) – 10 (critical). */
  priority: number;
  /** Hebrew parenting tip surfaced alongside the basket. */
  parentingTip: string;
}

/** Why a single product made it into the basket. */
export interface BasketItem {
  product: Product;
  /** Suggested units to buy. */
  quantity: number;
  /** Engine score, higher is a better fit. */
  score: number;
  /** Hebrew, customer-facing explanation, e.g. "אין לך עדיין שק שינה למידה הזו". */
  reason: string;
  /** The milestone gap this item closes; `null` for weather- or bestseller-driven picks. */
  closesGap: ProductCategory | null;
  /** What drove the recommendation. */
  trigger:
    | 'milestone_gap'
    | 'seasonal'
    | 'weather'
    | 'size_upgrade'
    | 'bestseller'
    | 'surplus_promo';
  /** Size the growth index recommends; `null` for non-apparel items. */
  recommendedSize: SizeCode | null;
  /** Size chosen for this line — the parent's override when they picked one. */
  selectedSize: SizeCode | null;
  /** True once a parent action (size override or NL swap) touched this line. */
  parentAdjusted: boolean;
}

/** The engine's output for one customer. */
export interface GeneratedBasket {
  id: string;
  customerId: string;
  /** ISO timestamp of generation. */
  generatedAt: string;
  /** Stage the baby is in right now. */
  currentStage: MilestoneStage;
  /** Stage the baby is approaching — the engine buys slightly ahead. */
  upcomingStage: MilestoneStage | null;
  babyAgeMonths: number;
  /** Season the basket was built for. */
  season: Season;
  /** Primary recommendations: milestone gaps and generic seasonality. */
  items: BasketItem[];
  /**
   * Secondary, lower-priority picks driven by weather anomalies (a cold snap in
   * the customer's city). Kept out of `items` so anomalies never outrank
   * developmental needs; surfaced as a separate "אולי גם" strip in the UI.
   */
  secondarySuggestions: BasketItem[];
  /** Where the baby sits on the growth ladder and the size the basket assumes. */
  growth: GrowthProjection;
  /** Sum of `price * quantity` across items, in ILS. */
  totalPrice: number;
  /** Total saving versus `originalPrice`, in ILS. */
  totalSavings: number;
  /** Required categories the customer is still missing. */
  gapCategories: ProductCategory[];
  /** Hebrew one-paragraph summary shown at the top of the basket. */
  summary: string;
  /** Hebrew headline, e.g. "הסל של נועם — שלב הזחילה". */
  headline: string;
}

/**
 * Campaign lifecycle. A campaign is born `pending_approval` and can only reach
 * `sent` by passing through an explicit human approval — there is no path from
 * detection straight to dispatch.
 */
export type CampaignStatus = 'pending_approval' | 'approved' | 'rejected' | 'sent';

/**
 * The two campaign streams.
 *
 * `lifecycle` is the primary, high-volume business case: babies grow out of
 * sizes, seasons turn, and parents drift away from the brand. These fire on a
 * predictable cadence and drive most of the revenue.
 *
 * `anomaly` is the secondary, reactive stream: a cold snap, a heatwave, a
 * warehouse overhang. It is opportunistic and must never crowd out the routine
 * milestone campaigns in the review queue.
 */
export type CampaignStream = 'lifecycle' | 'anomaly';

export type CampaignType =
  // lifecycle stream
  | 'growth_milestone' // מעבר מידה לפי מדד הגדילה
  | 'season_shift' // כניסה לעונה חדשה
  | 'replenishment' // זמן רב מהרכישה האחרונה
  // anomaly stream
  | 'cold_snap'
  | 'heatwave'
  | 'surplus_stock';

/** The audience definition behind a campaign, as shown in the review queue. */
export interface CampaignSegment {
  /** Hebrew segment name, e.g. "מעבר מידה 68→74 + כניסה לעונת מעבר". */
  label: string;
  /**
   * Short Hebrew trigger chips summarising why this segment was built,
   * e.g. ["עברו 3 חודשים", "קפיצת מידה 62→68", "כניסה לחורף"].
   */
  triggers: string[];
}

/**
 * Audience sizing and revenue projection.
 *
 * `matchedInSample` is a real count from the seeded profiles. `estimatedReach`
 * and `projectedRevenue` are *projections* onto a full CRM, derived from the
 * documented constants in `campaignEngine.ts` — they are estimates for planning,
 * not measured figures, and the UI labels them as such.
 */
export interface CampaignAudience {
  /** Customers in the seeded dataset that actually matched. */
  matchedInSample: number;
  /** Projected size of this segment across the full customer base. */
  estimatedReach: number;
  /** Assumed conversion rate used for the projection, 0-1. */
  assumedConversionRate: number;
  /** Assumed order value in ILS per converting parent. */
  averageBasketValue: number;
  /**
   * What the order value represents. Lifecycle campaigns sell a full seasonal
   * wardrobe refresh (5-8 staples); reactive campaigns sell a single impulse
   * item, because most parents make do with what they already own.
   */
  aovBasis: 'seasonal_wardrobe' | 'single_item';
  /** estimatedReach x conversion x average order value, in ILS. */
  projectedRevenue: number;
}

/** The parts of a campaign a marketing manager may edit before approving. */
export interface CampaignCopy {
  /** Hebrew campaign title. */
  title: string;
  /**
   * Hebrew body copy. Lifecycle messages are templates containing placeholders
   * ({{parentName}}, {{babyName}}, {{babyAgeMonths}}, {{monthsSincePurchase}},
   * {{nextSize}}, {{upcomingSeason}}) resolved per recipient by
   * `renderCampaignMessage`.
   */
  message: string;
  /** Hebrew call-to-action label, e.g. "לצפייה בסל". */
  ctaLabel: string;
  /** Discount offered, 0–100. `0` means the campaign carries no discount. */
  discountPercent: number;
}

/** One entry in a campaign's audit trail. */
export interface CampaignAuditEntry {
  /** ISO timestamp of the action. */
  at: string;
  action: 'detected' | 'edited' | 'approved' | 'rejected' | 'sent';
  /** Who acted. `'system'` for detection, otherwise the reviewer's identifier. */
  actor: string;
  /** Hebrew note describing what changed or why. */
  note: string;
}

/** A campaign proposal produced by the anomaly detector, awaiting a human. */
export interface Campaign {
  id: string;
  /** Which review queue this belongs to. */
  stream: CampaignStream;
  type: CampaignType;
  /** Who this targets and why. */
  segment: CampaignSegment;
  /** Reach and revenue projection for the review queue. */
  audience: CampaignAudience;
  /**
   * Customer whose details render the WhatsApp preview. Lifecycle copy is a
   * template, so a reviewer needs to see it resolved against a real recipient.
   */
  previewCustomerId: string | null;
  /** Editable, customer-facing copy. */
  copy: CampaignCopy;
  /** Copy exactly as the detector proposed it, kept for diffing against edits. */
  originalCopy: CampaignCopy;
  /** Products the campaign promotes. */
  productIds: string[];
  /** Customers matched to the campaign. */
  targetCustomerIds: string[];
  /** Never auto-send: campaigns wait for a human. */
  status: CampaignStatus;
  /** ISO timestamp of detection. */
  detectedAt: string;
  /** Hebrew explanation of the signal that fired, for the reviewer. */
  triggerReason: string;
  /** The raw numbers behind the signal, so a reviewer can judge it themselves. */
  evidence: CampaignEvidence;
  /** Detector confidence, 0–1. */
  confidence: number;
  /** How urgent dispatch is, for queue ordering in the review UI. */
  severity: 'low' | 'medium' | 'high';
  /** Full audit trail, oldest first. */
  audit: CampaignAuditEntry[];
  /** Identifier of the reviewer who approved or rejected; `null` while pending. */
  reviewedBy: string | null;
  /** ISO timestamp of the review decision; `null` while pending. */
  reviewedAt: string | null;
}

/** One matched parent inside a lifecycle segment, shown as reviewer evidence. */
export interface LifecycleEvidenceRow {
  customerId: string;
  parentName: string;
  babyName: string;
  babyAgeMonths: number;
  /** Whole months since this parent's last order. */
  monthsSincePurchase: number;
  currentSize: SizeCode;
  nextSize: SizeCode | null;
}

/** The measurements that triggered a campaign, surfaced to the reviewer. */
export interface CampaignEvidence {
  /** Per-parent breakdown, for lifecycle campaigns. */
  lifecycleRows?: LifecycleEvidenceRow[];
  /** Season the segment is being prepared for. */
  upcomingSeason?: Season;
  /** Hebrew city name, for cold-snap campaigns. */
  city?: string;
  /** Current temperature in °C. */
  temperatureC?: number;
  /** Rolling 7-day average in °C. */
  averageTemperatureC?: number;
  /** Drop below average in °C (positive number = colder than usual). */
  temperatureDropC?: number;
  /** Per-SKU surplus figures, for stock campaigns. */
  surplusItems?: Array<{
    productId: string;
    productName: string;
    stock: number;
    surplusThreshold: number;
    /** Units above the threshold. */
    excessUnits: number;
  }>;
}

/** A weather reading for one city, consumed by the cold-snap detector. */
export interface WeatherSnapshot {
  /** Hebrew city name, matching `CustomerProfile.city`. */
  city: string;
  /** Current temperature in °C. */
  temperatureC: number;
  /** Rolling 7-day average temperature in °C. */
  averageTemperatureC: number;
  season: Season;
  /** ISO timestamp of the reading. */
  recordedAt: string;
}

/* -------------------------- Basket manipulation --------------------------- */

/** A single change the natural-language parser made to a basket. */
export interface BasketModification {
  action: 'swapped' | 'removed' | 'added' | 'resized';
  /** Product removed from the basket, when the action removed or swapped one. */
  removedProductId?: string;
  /** Product added to the basket, when the action added or swapped one. */
  addedProductId?: string;
  /** Hebrew explanation of the change, shown back to the parent as confirmation. */
  explanation: string;
}

/** What the parser understood from a free-text Hebrew instruction. */
export interface ParsedIntent {
  /** Attributes the parent rejected, e.g. `['short', 'summer']`. */
  rejected: string[];
  /** Attributes the parent asked for instead, e.g. `['long']`. */
  preferred: string[];
  /** Categories the instruction targets; empty means "any category in the basket". */
  categories: ProductCategory[];
  /** True when the instruction only removes, with no replacement requested. */
  removeOnly: boolean;
}

/** Outcome of `modifyBasketWithNaturalLanguage`. */
export interface BasketModificationResult {
  /** The updated basket. Unchanged instance-wise when nothing matched. */
  basket: GeneratedBasket;
  /** Every change applied, in order. */
  modifications: BasketModification[];
  /** What the parser extracted, exposed so the UI can show its reading. */
  intent: ParsedIntent;
  /** True when at least one change was applied. */
  understood: boolean;
  /** Hebrew message for the parent — a confirmation, or why nothing changed. */
  message: string;
}

/** Hebrew display labels for each product category. */
export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  bodysuit: 'בגדי גוף',
  footie: 'אוברולים ורגליות',
  crawling_pants: 'מכנסי זחילה',
  sleep_sack: 'שקי שינה',
  feeding_set: 'ערכות האכלה וגמילה',
  outerwear: 'הלבשה עליונה',
  hat_accessories: 'כובעים ואביזרים',
  socks_shoes: 'גרביים ונעליים',
  bath_care: 'רחצה וטיפוח',
  bedding: 'מצעים ושמיכות',
  toys_development: 'צעצועי התפתחות',
  first_walk: 'צעדים ראשונים',
};

/** Hebrew display labels for each milestone stage. */
export const STAGE_LABELS: Record<MilestoneStage, string> = {
  newborn: 'יילוד',
  early_infant: 'תינוק צעיר',
  sitting: 'שלב הישיבה',
  crawling: 'שלב הזחילה',
  first_steps: 'צעדים ראשונים',
  toddler: 'פעוט',
  independent: 'עצמאות',
};

/** Hebrew display labels for each season. */
export const SEASON_LABELS: Record<Season, string> = {
  winter: 'חורף',
  summer: 'קיץ',
  transitional: 'עונת מעבר',
  all_season: 'כל השנה',
};
