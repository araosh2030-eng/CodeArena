import React from 'react';
import { Language, NotificationTone, TeamNotification } from '../../types/game';
import { X } from 'lucide-react';

interface NotificationToastBannerProps {
  toast: TeamNotification | null;
  queuedCount: number;
  language: Language;
  onOpenCenter: (notification: TeamNotification) => void;
  onDismiss: () => void;
}

const TONE_CLASSES: Record<NotificationTone, string> = {
  positive: 'bg-emerald-950/95 border-emerald-500/50 text-emerald-50 shadow-emerald-950/60',
  negative: 'bg-rose-950/95 border-rose-500/50 text-rose-50 shadow-rose-950/60',
  warning: 'bg-amber-950/95 border-amber-500/50 text-amber-50 shadow-amber-950/60',
  info: 'bg-slate-900/95 border-cyan-500/50 text-slate-50 shadow-slate-950/80',
};

const TONE_SUBTEXT: Record<NotificationTone, string> = {
  positive: 'text-emerald-200/90',
  negative: 'text-rose-200/90',
  warning: 'text-amber-200/90',
  info: 'text-slate-300',
};

export const NotificationToastBanner: React.FC<NotificationToastBannerProps> = ({
  toast,
  queuedCount,
  language,
  onOpenCenter,
  onDismiss,
}) => {
  if (!toast) return null;

  const isAr = language === 'ar';
  const title = isAr ? toast.titleAr : toast.titleEn;
  const message = isAr ? toast.messageAr : toast.messageEn;
  const toneClass = TONE_CLASSES[toast.tone] || TONE_CLASSES.info;
  const subTextClass = TONE_SUBTEXT[toast.tone] || TONE_SUBTEXT.info;

  return (
    <div
      className="fixed top-[60px] left-1/2 -translate-x-1/2 z-40 w-[min(94vw,480px)] pointer-events-none px-2"
      aria-live="polite"
      data-testid="notification-toast-wrapper"
    >
      <div
        role="status"
        data-testid="notification-toast-banner"
        dir={isAr ? 'rtl' : 'ltr'}
        className={`pointer-events-auto flex items-center gap-2.5 px-3 py-2 rounded-2xl border backdrop-blur-md shadow-2xl transition-all duration-200 ${toneClass}`}
      >
        <button
          type="button"
          onClick={() => onOpenCenter(toast)}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-start py-0.5 focus:outline-none"
        >
          <span
            className="w-8 h-8 rounded-xl bg-black/25 border border-white/10 flex items-center justify-center text-base shrink-0"
            aria-hidden="true"
          >
            {toast.emoji}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black truncate">{title}</span>
              {queuedCount > 0 && (
                <span className="text-[10px] font-mono font-bold opacity-80 shrink-0 tabular-nums">
                  {isAr ? `+${queuedCount} أخرى` : `+${queuedCount} more`}
                </span>
              )}
            </div>
            <p className={`text-[11px] leading-snug truncate ${subTextClass}`}>{message}</p>
          </div>
        </button>

        <button
          type="button"
          onClick={onDismiss}
          aria-label={isAr ? 'إغلاق الإشعار' : 'Dismiss notification'}
          className="min-w-[36px] min-h-[36px] rounded-xl flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
