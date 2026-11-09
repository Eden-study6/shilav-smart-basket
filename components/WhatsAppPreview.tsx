'use client';

import { useEffect } from 'react';
import { Check, ChevronLeft, Mic, Plus, Smile, Video, X } from 'lucide-react';
import type { Campaign, CustomerProfile } from '@/lib/types';

interface WhatsAppPreviewProps {
  campaign: Campaign;
  /** Recipient the template is resolved against. */
  customer: CustomerProfile;
  /** Message text after placeholder substitution. */
  message: string;
  onClose: () => void;
}

/**
 * Israel runs UTC+3 in summer. Formatting the timestamp with fixed arithmetic
 * rather than `toLocaleTimeString` keeps the markup identical on server and
 * client, which a locale- or timezone-dependent format would not guarantee.
 */
function formatChatTime(iso: string): string {
  const utc = new Date(iso);
  const israel = new Date(utc.getTime() + 3 * 60 * 60 * 1000);
  const hours = String(israel.getUTCHours()).padStart(2, '0');
  const minutes = String(israel.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Shows the marketing manager exactly what a parent receives on WhatsApp,
 * with the campaign template already resolved against a real recipient.
 */
export function WhatsAppPreview({
  campaign,
  customer,
  message,
  onClose,
}: WhatsAppPreviewProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const time = formatChatTime(campaign.detectedAt);
  const discount = campaign.copy.discountPercent;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`תצוגה מקדימה של ההודעה ל${customer.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[330px]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירת התצוגה המקדימה"
          className="absolute -top-11 end-0 grid size-9 place-items-center rounded-full bg-cream-50 text-ink shadow-lg transition-colors hover:bg-cream-200"
        >
          <X className="size-4" aria-hidden />
        </button>

        {/* iPhone shell */}
        <div className="rounded-[2.75rem] border border-[#3a3a3c] bg-[#1c1c1e] p-2.5 shadow-2xl">
          <div className="relative overflow-hidden rounded-[2.25rem] bg-[#ECE5DD]">
            {/* Notch */}
            <div className="absolute inset-x-0 top-0 z-10 flex justify-center">
              <div className="h-6 w-32 rounded-b-2xl bg-[#1c1c1e]" />
            </div>

            {/* WhatsApp header */}
            <div className="flex items-center gap-2.5 bg-[#075E54] px-3 pb-2.5 pt-8 text-white">
              <ChevronLeft className="size-5 shrink-0 rtl:rotate-180" aria-hidden />
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#25D366] text-sm font-bold text-white">
                ש
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold">שילב</p>
                <p className="truncate text-[11px] text-white/70">חשבון עסקי</p>
              </div>
              <Video className="size-4 shrink-0 text-white/80" aria-hidden />
            </div>

            {/* Conversation */}
            <div className="min-h-[330px] space-y-2 px-3 py-4">
              <div className="mx-auto w-fit rounded-lg bg-[#FCF4CB] px-2.5 py-1 text-[10px] text-[#54656f] shadow-sm">
                היום
              </div>

              {/* Incoming business message — start-aligned, which is the right in RTL */}
              <div className="me-auto max-w-[86%] overflow-hidden rounded-2xl rounded-se-sm bg-white shadow-sm">
                <div className="px-3 pb-1.5 pt-2.5">
                  <p className="text-[13px] leading-relaxed text-[#111b21]">{message}</p>
                  {discount > 0 && (
                    <p className="mt-1.5 text-[13px] font-semibold text-[#075E54]">
                      <span className="ltr-nums">{discount}%</span> הנחה מחכים לך 🎁
                    </p>
                  )}
                  <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
                    <span className="ltr-nums">{time}</span>
                    <Check className="size-3" aria-hidden />
                  </p>
                </div>

                {/* Interactive CTA button */}
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 border-t border-[#e9edef] py-2.5 text-[13px] font-medium text-[#00A5F4]"
                >
                  {campaign.copy.ctaLabel}
                </button>
              </div>
            </div>

            {/* Composer */}
            <div className="flex items-center gap-2 bg-[#F0F0F0] px-2.5 py-2">
              <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-2">
                <Smile className="size-4 text-[#8696a0]" aria-hidden />
                <span className="flex-1 text-[11px] text-[#8696a0]">הודעה</span>
                <Plus className="size-4 text-[#8696a0]" aria-hidden />
              </div>
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[#25D366]">
                <Mic className="size-4 text-white" aria-hidden />
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-cream-100">
          תצוגה מקדימה עבור {customer.name} · התינוק/ת {customer.babyName}
        </p>
      </div>
    </div>
  );
}
