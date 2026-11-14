import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GameState,
  NotificationPriority,
  TeamNotification,
  TeamNotificationPreferences,
} from '../types/game';

const PREFS_STORAGE_KEY = 'codearena_notif_prefs';

const DEFAULT_PREFERENCES: TeamNotificationPreferences = {
  toastsEnabled: true,
  toastDurationMs: 3500,
  showLowPriority: true,
};

const PRIORITY_WEIGHT: Record<NotificationPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function loadPreferences(): TeamNotificationPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    const validDuration =
      parsed.toastDurationMs === 2500 ||
      parsed.toastDurationMs === 3500 ||
      parsed.toastDurationMs === 5000
        ? parsed.toastDurationMs
        : 3500;
    return {
      toastsEnabled: typeof parsed.toastsEnabled === 'boolean' ? parsed.toastsEnabled : true,
      toastDurationMs: validDuration,
      showLowPriority: typeof parsed.showLowPriority === 'boolean' ? parsed.showLowPriority : true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

interface UseTeamNotificationsOptions {
  teamId: string | null | undefined;
  state: GameState | null;
  markNotificationRead: (teamId: string, notificationId: string) => Promise<boolean>;
  markAllNotificationsRead: (teamId: string) => Promise<number>;
}

export function useTeamNotifications({
  teamId,
  state,
  markNotificationRead,
  markAllNotificationsRead,
}: UseTeamNotificationsOptions) {
  const [preferences, setPreferences] = useState<TeamNotificationPreferences>(() => loadPreferences());
  const [activeToast, setActiveToast] = useState<TeamNotification | null>(null);
  const [toastQueue, setToastQueue] = useState<TeamNotification[]>([]);

  const seenToastIdsRef = useRef<Set<string>>(new Set());
  const initializedContextRef = useRef<string | null>(null);

  const notifications = useMemo<TeamNotification[]>(() => {
    if (!teamId || !state?.notificationsByTeam?.[teamId]) return [];
    return [...state.notificationsByTeam[teamId]].sort((a, b) => b.timestamp - a.timestamp);
  }, [state?.notificationsByTeam, teamId]);

  const unreadCount = useMemo(
    () => notifications.reduce((acc, item) => (item.read ? acc : acc + 1), 0),
    [notifications]
  );

  // Sync incoming notifications and seed initial snapshot so refresh/reconnect never replays old toasts
  useEffect(() => {
    const rawTeamList = teamId ? state?.notificationsByTeam?.[teamId] : undefined;
    if (!teamId || !state?.gameId) {
      initializedContextRef.current = null;
      seenToastIdsRef.current.clear();
      setActiveToast(null);
      setToastQueue([]);
      return;
    }

    // Wait for team-scoped payload containing notificationsByTeam[teamId] array before seeding
    if (!Array.isArray(rawTeamList)) {
      return;
    }

    const contextKey = `${state.gameId}:${teamId}`;
    if (initializedContextRef.current !== contextKey) {
      initializedContextRef.current = contextKey;
      seenToastIdsRef.current = new Set(notifications.map(n => n.id));
      setActiveToast(null);
      setToastQueue([]);
      return;
    }

    const newlyArrived: TeamNotification[] = [];
    for (const item of notifications) {
      if (!seenToastIdsRef.current.has(item.id)) {
        seenToastIdsRef.current.add(item.id);
        if (
          !item.read &&
          preferences.toastsEnabled &&
          (preferences.showLowPriority || item.priority !== 'low')
        ) {
          newlyArrived.push(item);
        }
      }
    }

    if (newlyArrived.length > 0) {
      newlyArrived.sort((a, b) => {
        const pDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
        return pDiff !== 0 ? pDiff : b.timestamp - a.timestamp;
      });
      setToastQueue(prev => [...prev, ...newlyArrived]);
    }
  }, [
    teamId,
    state?.gameId,
    notifications,
    preferences.toastsEnabled,
    preferences.showLowPriority,
  ]);

  // Pop 1 banner at a time from priority queue
  useEffect(() => {
    if (activeToast || toastQueue.length === 0) return;

    const sorted = [...toastQueue].sort((a, b) => {
      const pDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      return pDiff !== 0 ? pDiff : a.timestamp - b.timestamp;
    });
    const [nextToast, ...rest] = sorted;
    setActiveToast(nextToast);
    setToastQueue(rest);
  }, [activeToast, toastQueue]);

  // Auto-dismiss active banner after configured duration
  useEffect(() => {
    if (!activeToast) return;
    const duration = preferences.toastDurationMs || activeToast.durationMs || 3500;
    const timer = setTimeout(() => {
      setActiveToast(null);
    }, duration);
    return () => clearTimeout(timer);
  }, [activeToast, preferences.toastDurationMs]);

  const dismissToast = useCallback(() => {
    setActiveToast(null);
  }, []);

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!teamId) return false;
      if (activeToast?.id === notificationId) {
        setActiveToast(null);
      }
      setToastQueue(prev => prev.filter(item => item.id !== notificationId));
      return markNotificationRead(teamId, notificationId);
    },
    [teamId, activeToast?.id, markNotificationRead]
  );

  const markAllRead = useCallback(async () => {
    if (!teamId) return 0;
    setActiveToast(null);
    setToastQueue([]);
    return markAllNotificationsRead(teamId);
  }, [teamId, markAllNotificationsRead]);

  const updatePreferences = useCallback((partial: Partial<TeamNotificationPreferences>) => {
    setPreferences(prev => {
      const next = { ...prev, ...partial };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore storage error
        }
      }
      if (!next.toastsEnabled) {
        setActiveToast(null);
        setToastQueue([]);
      }
      return next;
    });
  }, []);

  return {
    notifications,
    unreadCount,
    activeToast,
    queuedCount: toastQueue.length,
    dismissToast,
    markRead,
    markAllRead,
    preferences,
    updatePreferences,
  };
}
