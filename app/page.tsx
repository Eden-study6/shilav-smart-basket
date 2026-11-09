'use client';

import { useMemo, useState } from 'react';
import { AdminDashboard } from '@/components/AdminDashboard';
import { DemoBar, type AppView } from '@/components/DemoBar';
import { ParentBasketView, type BasketNotice } from '@/components/ParentBasketView';
import {
  approveCampaign,
  detectAllCampaigns,
  editCampaignCopy,
  markCampaignSent,
  rejectCampaign,
} from '@/lib/campaignEngine';
import {
  generateBasket,
  modifyBasketWithNaturalLanguage,
  updateBasketSizes,
} from '@/lib/engine';
import { CUSTOMERS, getWeatherForCity } from '@/lib/mockData';
import type { Campaign, CampaignCopy, GeneratedBasket, SizeCode } from '@/lib/types';

/**
 * Fixed reference date for the demo. Injecting it keeps the engine deterministic
 * and keeps the server-rendered markup identical to the first client render.
 */
const DEMO_NOW = new Date('2026-09-08T09:00:00+03:00');

/** Recorded on every campaign decision in the audit trail. */
const REVIEWER = 'dana@shilav.co.il';

export default function Home() {
  const [activeView, setActiveView] = useState<AppView>('parent');
  const [activeCustomerId, setActiveCustomerId] = useState(CUSTOMERS[0].id);

  /** Parent edits (size override, natural-language swaps) layer over the engine output. */
  const [editedBasket, setEditedBasket] = useState<GeneratedBasket | null>(null);
  const [basketNotice, setBasketNotice] = useState<BasketNotice | null>(null);
  /** Size the parent picked, so the size control reflects their choice rather than snapping back. */
  const [appliedSize, setAppliedSize] = useState<SizeCode | null>(null);

  const [campaigns, setCampaigns] = useState<Campaign[]>(() =>
    detectAllCampaigns({ now: DEMO_NOW }),
  );
  const [adminNotice, setAdminNotice] = useState<BasketNotice | null>(null);

  const customer =
    CUSTOMERS.find((profile) => profile.id === activeCustomerId) ?? CUSTOMERS[0];

  // Re-runs whenever the demo switches profile, so the basket follows the selection.
  const baseBasket = useMemo(
    () =>
      generateBasket(customer, {
        now: DEMO_NOW,
        weather: getWeatherForCity(customer.city),
      }),
    [customer],
  );

  const basket = editedBasket ?? baseBasket;

  /* ------------------------------ Parent actions ----------------------------- */

  const selectCustomer = (customerId: string) => {
    setActiveCustomerId(customerId);
    setEditedBasket(null); // a new baby means a fresh recommendation
    setBasketNotice(null);
    setAppliedSize(null);
  };

  const applySize = (size: SizeCode) => {
    setAppliedSize(size);
    setEditedBasket(updateBasketSizes(basket, size));
    setBasketNotice({
      text: `עדכנו את כל הפריטים המשויכים למידה ${size}. פריטים ללא מידה (האכלה, צעצועים) לא הושפעו.`,
      ok: true,
    });
  };

  const applyNaturalLanguage = (query: string) => {
    const result = modifyBasketWithNaturalLanguage(basket, query);
    if (result.understood) setEditedBasket(result.basket);
    setBasketNotice({ text: result.message, ok: result.understood });
  };

  const resetBasket = () => {
    setEditedBasket(null);
    setAppliedSize(null);
    setBasketNotice({ text: 'הסל אופס להמלצה המקורית של המערכת.', ok: true });
  };

  /* ------------------------------ Admin actions ------------------------------ */

  /**
   * Apply a review action to one campaign and surface its message.
   *
   * The action runs outside the state updater on purpose: a `setState` updater
   * must be a pure function, and React invokes it twice under StrictMode, so
   * setting the notice inside it fired the side effect twice.
   */
  const runCampaignAction = (
    campaignId: string,
    action: (campaign: Campaign) => { campaign: Campaign; ok: boolean; message: string },
  ) => {
    const target = campaigns.find((campaign) => campaign.id === campaignId);
    if (!target) return;

    const result = action(target);
    setAdminNotice({ text: result.message, ok: result.ok });
    setCampaigns((current) =>
      current.map((campaign) => (campaign.id === campaignId ? result.campaign : campaign)),
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <DemoBar
        customers={CUSTOMERS}
        activeCustomerId={activeCustomerId}
        onSelectCustomer={selectCustomer}
        activeView={activeView}
        onChangeView={setActiveView}
        pendingCount={
          campaigns.filter((campaign) => campaign.status === 'pending_approval').length
        }
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-5">
        {activeView === 'parent' ? (
          <ParentBasketView
            basket={basket}
            customer={customer}
            activeSize={appliedSize ?? basket.growth.recommendedSize}
            onApplySize={applySize}
            onNaturalLanguage={applyNaturalLanguage}
            onReset={resetBasket}
            notice={basketNotice}
            isEdited={editedBasket !== null}
          />
        ) : (
          <AdminDashboard
            campaigns={campaigns}
            customers={CUSTOMERS}
            now={DEMO_NOW}
            reviewer={REVIEWER}
            notice={adminNotice}
            onApprove={(id) =>
              runCampaignAction(id, (campaign) =>
                approveCampaign(campaign, REVIEWER, { now: DEMO_NOW }),
              )
            }
            onReject={(id, reason) =>
              runCampaignAction(id, (campaign) =>
                rejectCampaign(campaign, REVIEWER, reason, DEMO_NOW),
              )
            }
            onEdit={(id, changes: Partial<CampaignCopy>) =>
              runCampaignAction(id, (campaign) =>
                editCampaignCopy(campaign, changes, REVIEWER, DEMO_NOW),
              )
            }
            onSend={(id) =>
              runCampaignAction(id, (campaign) =>
                markCampaignSent(campaign, REVIEWER, DEMO_NOW),
              )
            }
          />
        )}
      </main>

      <footer className="border-t border-cream-300 bg-cream-50 py-6 text-center">
        <p className="text-xs text-ink-light">
          שילב · מנוע הסל האישי · הדגמה פנימית
        </p>
      </footer>
    </div>
  );
}
