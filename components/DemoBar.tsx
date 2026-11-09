'use client';

import { Baby, LayoutDashboard, ShoppingBasket } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CustomerProfile } from '@/lib/types';

export type AppView = 'parent' | 'admin';

interface DemoBarProps {
  customers: CustomerProfile[];
  activeCustomerId: string;
  onSelectCustomer: (customerId: string) => void;
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  /** Campaigns awaiting a human decision, badged on the admin tab. */
  pendingCount: number;
}

/**
 * Demo control strip: switch between the parent-facing basket and the marketing
 * console, and jump between the six seeded customer profiles.
 */
export function DemoBar({
  customers,
  activeCustomerId,
  onSelectCustomer,
  activeView,
  onChangeView,
  pendingCount,
}: DemoBarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-cream-300/70 bg-cream-50/85 backdrop-blur-md">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-2xl bg-terracotta-200 text-terracotta-600">
              <ShoppingBasket className="size-5" aria-hidden />
            </span>
            <div className="leading-tight">
              <p className="text-base font-bold tracking-tight">שילב</p>
              <p className="text-xs text-ink-muted">הסל החכם</p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="מצב תצוגה"
            className="flex items-center gap-1 rounded-full bg-cream-200 p-1"
          >
            <ViewTab
              icon={<Baby className="size-4" aria-hidden />}
              label="הורה"
              isActive={activeView === 'parent'}
              onClick={() => onChangeView('parent')}
            />
            <ViewTab
              icon={<LayoutDashboard className="size-4" aria-hidden />}
              label="ניהול"
              badge={pendingCount}
              isActive={activeView === 'admin'}
              onClick={() => onChangeView('admin')}
            />
          </div>
        </div>

        {activeView === 'parent' && (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-ink-muted">בחרו פרופיל להדגמה</p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {customers.map((customer) => {
                const isActive = customer.id === activeCustomerId;
                return (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => onSelectCustomer(customer.id)}
                    aria-pressed={isActive}
                    className={cn(
                      'shrink-0 rounded-full border px-3.5 py-2 text-start transition-colors',
                      isActive
                        ? 'border-terracotta-400 bg-terracotta-100 text-terracotta-600'
                        : 'border-cream-300 bg-cream-50 text-ink-muted hover:border-sage-300 hover:bg-sage-100',
                    )}
                  >
                    <span className="block text-sm font-semibold leading-tight">
                      {customer.babyName}
                    </span>
                    <span className="block text-xs leading-tight opacity-80">
                      <span className="ltr-nums">{customer.babyAgeMonths}</span> חודשים ·{' '}
                      {customer.city}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function ViewTab({
  icon,
  label,
  isActive,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
        isActive ? 'bg-cream-50 text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
      )}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ltr-nums grid min-w-5 place-items-center rounded-full bg-terracotta-400 px-1 text-xs font-semibold text-cream-50">
          {badge}
        </span>
      )}
    </button>
  );
}
