import React, { useMemo, useState } from 'react';
import {
  Language,
  NotificationCategory,
  NotificationTone,
  TeamNotification,
  TeamNotificationPreferences,
} from '../../types/game';
import { Bell, CheckCheck, SlidersHorizontal, X } from 'lucide-react';

type FilterTab = 'all' | 'unread' | 'points' | 'cards' | 'ranking' | 'gameplay';

interface NotificationCenterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: TeamNotification[];
  unreadCount: number;
  language: Language;
  onToggleLanguage?: () => void;
  onMarkRead: (notificationId: string) => void;
  onMarkAllRead: () => void;
  preferences: TeamNotificationPreferences;
  onUpdatePreferences: (partial: Partial<TeamNotificationPreferences>) => void;
}

const TONE_DOT: Record<NotificationTone, string> = {
  positive: 'bg-emerald-400',
  negative: 'bg-rose-400',
  warning: 'bg-amber-400',
  info: 'bg-cyan-400',
};

const TONE_CARD_BG: Record<NotificationTone, string> = {
  positive: 'bg-emerald-950/35 border-emerald-500/35',
  negative: 'bg-rose-950/35 border-rose-500/35',
  warning: 'bg-amber-950/35 border-amber-500/35',
  info: 'bg-slate-900/90 border-cyan-500/30',
};

const GAMEPLAY_CATEGORIES: NotificationCategory[] = [
  'rounds',
  'private_rounds',
  'comeback',
  'double_points',
  'rivalry',
  'player_exchange',
  'team_activity',
  'match_status',
  'milestones',
];

function getCategoryLabel(category: NotificationCategory, isAr: boolean): string {
  const labels: Record<NotificationCategory, { en: string; ar: string }> = {
    points: { en: 'Points', ar: 'النقاط' },
    ranking: { en: 'Ranking', ar: 'الترتيب' },
    cards: { en: 'Cards', ar: 'الكروت' },
    player_exchange: { en: 'Swap', ar: 'التبديل' },
    comeback: { en: 'Comeback', ar: 'العودة' },
    double_points: { en: '2x Points', ar: 'مضاعفة' },
    rivalry: { en: 'Rivalry', ar: 'التنافس' },
    rounds: { en: 'Round', ar: 'الجولة' },
    private_rounds: { en: 'Private', ar: 'خاصة' },
    match_status: { en: 'Match', ar: 'المسابقة' },
    team_activity: { en: 'Team', ar: 'الفريق' },
    milestones: { en: 'Milestone', ar: 'إنجاز' },
  };
  return isAr ? labels[category]?.ar || category : labels[category]?.en || category;
}

function formatNotifTime(ts: number, isAr: boolean): string {
  try {
    return new Intl.DateTimeFormat(isAr ? 'ar-EG' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

export const NotificationCenterDrawer: React.FC<NotificationCenterDrawerProps> = ({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  language,
  onToggleLanguage,
  onMarkRead,
  onMarkAllRead,
  preferences,
  onUpdatePreferences,
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const isAr = language === 'ar';

  const filteredNotifications = useMemo(() => {
    switch (activeFilter) {
      case 'unread':
        return notifications.filter(n => !n.read);
      case 'points':
        return notifications.filter(
          n => n.category === 'points' || n.category === 'double_points' || n.category === 'milestones'
        );
      case 'cards':
        return notifications.filter(n => n.category === 'cards');
      case 'ranking':
        return notifications.filter(n => n.category === 'ranking');
      case 'gameplay':
        return notifications.filter(n => GAMEPLAY_CATEGORIES.includes(n.category));
      case 'all':
      default:
        return notifications;
    }
  }, [notifications, activeFilter]);

  if (!isOpen) return null;

  const tabs: Array<{ id: FilterTab; en: string; ar: string }> = [
    { id: 'all', en: 'All', ar: 'الكل' },
    { id: 'unread', en: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}`, ar: `غير مقروء${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
    { id: 'points', en: 'Points', ar: 'النقاط' },
    { id: 'cards', en: 'Cards', ar: 'الكروت' },
    { id: 'ranking', en: 'Ranking', ar: 'الترتيب' },
    { id: 'gameplay', en: 'Gameplay', ar: 'اللعب' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-[2px]"
      onClick={onClose}
      data-testid="notification-center-backdrop"
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isAr ? 'مركز الإشعارات' : 'Notification Center'}
        dir={isAr ? 'rtl' : 'ltr'}
        onClick={e => e.stopPropagation()}
        data-testid="notification-center-drawer"
        className="w-full max-w-[440px] h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Drawer Header */}
        <div className="shrink-0 px-3.5 py-2.5 bg-slate-950/90 border-b border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
                <Bell className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[13px] font-black text-white whitespace-nowrap">
                    {isAr ? 'مركز الإشعارات' : 'Notifications'}
                  </h2>
                  {unreadCount > 0 && (
                    <span
                      data-testid="drawer-unread-count"
                      className="px-1.5 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-500/40 text-[10px] font-mono font-black text-cyan-300 tabular-nums shrink-0"
                    >
                      {unreadCount}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 truncate">
                  {isAr ? 'تنبيهات فريقك المباشرة' : 'Real-time team updates'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onMarkAllRead}
                disabled={unreadCount === 0}
                data-testid="mark-all-read-btn"
                title={isAr ? 'تحديد الكل كمقروء' : 'Mark all as read'}
                className="min-h-[36px] px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-[11px] font-bold text-cyan-300 flex items-center gap-1 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isAr ? 'قراءة الكل' : 'Mark Read'}</span>
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen(prev => !prev)}
                data-testid="notification-settings-toggle"
                aria-expanded={settingsOpen}
                aria-label={isAr ? 'إعدادات الإشعارات' : 'Notification settings'}
                className={`min-w-[36px] min-h-[36px] rounded-xl border flex items-center justify-center transition-colors ${
                  settingsOpen
                    ? 'bg-cyan-600 border-cyan-400 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={onClose}
                data-testid="close-notification-center"
                aria-label={isAr ? 'إغلاق مركز الإشعارات' : 'Close Notification Center'}
                className="min-w-[36px] min-h-[36px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Header Customization Settings Panel */}
          {settingsOpen && (
            <div
              data-testid="notification-settings-panel"
              className="p-2.5 rounded-2xl bg-slate-900 border border-slate-700/80 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-slate-200 block">
                    {isAr ? 'الإشعارات المنبثقة (Toasts)' : 'Pop-up Toasts'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {isAr ? 'السجل الدائم يبقى مفعلاً دائماً' : 'Permanent history always remains saved'}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="toggle-toasts-enabled"
                  onClick={() => onUpdatePreferences({ toastsEnabled: !preferences.toastsEnabled })}
                  className={`min-h-[32px] px-3 rounded-xl font-bold text-[11px] border transition-colors ${
                    preferences.toastsEnabled
                      ? 'bg-emerald-600/30 border-emerald-500 text-emerald-200'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  {preferences.toastsEnabled ? (isAr ? 'مفعل' : 'ON') : isAr ? 'متوقف' : 'OFF'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-200">
                  {isAr ? 'مدة ظهور التنبيه' : 'Toast Duration'}
                </span>
                <div className="flex items-center gap-1">
                  {([2500, 3500, 5000] as const).map(ms => (
                    <button
                      key={ms}
                      type="button"
                      data-testid={`duration-${ms}`}
                      onClick={() => onUpdatePreferences({ toastDurationMs: ms })}
                      className={`min-h-[30px] px-2 rounded-lg font-mono text-[11px] font-bold border transition-colors tabular-nums ${
                        preferences.toastDurationMs === ms
                          ? 'bg-cyan-600 border-cyan-400 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                    >
                      {(ms / 1000).toFixed(1)}s
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-200">
                  {isAr ? 'تنبيهات الأولوية المنخفضة' : 'Low-Priority Toasts'}
                </span>
                <button
                  type="button"
                  data-testid="toggle-low-priority"
                  onClick={() => onUpdatePreferences({ showLowPriority: !preferences.showLowPriority })}
                  className={`min-h-[32px] px-3 rounded-xl font-bold text-[11px] border transition-colors ${
                    preferences.showLowPriority
                      ? 'bg-cyan-600/30 border-cyan-500 text-cyan-200'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  {preferences.showLowPriority ? (isAr ? 'ظاهر' : 'Show') : isAr ? 'مخفي' : 'Hide'}
                </button>
              </div>

              {onToggleLanguage && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                  <span className="font-bold text-slate-200">
                    {isAr ? 'لغة الإشعارات' : 'Notification Language'}
                  </span>
                  <button
                    type="button"
                    data-testid="toggle-notif-language"
                    onClick={onToggleLanguage}
                    className="min-h-[32px] px-3 rounded-xl font-bold text-[11px] border bg-slate-800 hover:bg-slate-700 border-slate-700 text-cyan-200 transition-colors"
                  >
                    {isAr ? 'العربية (تبديل لـ EN)' : 'English (Switch AR)'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Category Filters */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
            {tabs.map(tab => {
              const active = activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`filter-tab-${tab.id}`}
                  onClick={() => setActiveFilter(tab.id)}
                  className={`min-h-[34px] px-2 rounded-xl text-[11px] font-bold whitespace-nowrap shrink-0 border transition-colors ${
                    active
                      ? 'bg-cyan-600 border-cyan-400 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {isAr ? tab.ar : tab.en}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Notification Feed */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="notification-list">
          {filteredNotifications.length === 0 ? (
            <div
              data-testid="notification-empty-state"
              className="h-full min-h-[180px] flex flex-col items-center justify-center text-center px-4 space-y-2"
            >
              <div className="w-11 h-11 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-xl">
                🎉
              </div>
              <p className="text-sm font-black text-slate-200">
                {activeFilter === 'all'
                  ? isAr
                    ? "أنت مطّلع على كل شيء! 🎉"
                    : "You're all caught up! 🎉"
                  : isAr
                  ? 'لا توجد إشعارات في هذا التصنيف'
                  : 'No notifications in this filter'}
              </p>
              <p className="text-xs text-slate-400 max-w-[240px]">
                {activeFilter === 'all'
                  ? isAr
                    ? 'لا توجد إشعارات جديدة حالياً.'
                    : 'No new notifications for now.'
                  : isAr
                  ? 'جرّب اختيار "الكل" لعرض جميع التنبيهات.'
                  : 'Switch to All to see your team activity feed.'}
              </p>
            </div>
          ) : (
            filteredNotifications.map(item => {
              const title = isAr ? item.titleAr : item.titleEn;
              const message = isAr ? item.messageAr : item.messageEn;
              const cardClasses = item.read
                ? 'bg-slate-950/60 border-slate-800/80 opacity-75 hover:opacity-100'
                : TONE_CARD_BG[item.tone] || TONE_CARD_BG.info;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (!item.read) onMarkRead(item.id);
                  }}
                  data-testid={`notification-item-${item.id}`}
                  data-read={item.read ? 'true' : 'false'}
                  className={`w-full text-start p-2.5 rounded-2xl border transition-all flex items-start gap-2.5 ${cardClasses}`}
                >
                  <span
                    className="w-8 h-8 rounded-xl bg-slate-900/90 border border-white/10 flex items-center justify-center text-base shrink-0 mt-0.5"
                    aria-hidden="true"
                  >
                    {item.emoji}
                  </span>

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-white leading-snug">
                        {title}
                      </span>
                      {!item.read && (
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[item.tone] || 'bg-cyan-400'}`}
                          aria-label={isAr ? 'غير مقروء' : 'Unread'}
                        />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed break-words">
                      {message}
                    </p>
                    <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 pt-0.5 tabular-nums">
                      <span>R{item.roundNumber}</span>
                      <span>·</span>
                      <span>{formatNotifTime(item.timestamp, isAr)}</span>
                      <span>·</span>
                      <span>{getCategoryLabel(item.category, isAr)}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
