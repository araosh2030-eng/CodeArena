import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { CardInstance, CardType, GameSettings, GameState, GiftDraft, Language, Question, TeamNotification } from '../types/game';
import { SoundCategory, soundEffects, SoundSettings } from '../utils/audio';

interface GameContextType {
  state: GameState | null;
  language: Language;
  setLanguage: (lang: Language) => void;
  connected: boolean;
  isMuted: boolean;
  toggleMute: () => void;
  soundSettings: SoundSettings;
  updateSoundSettings: (partial: Partial<SoundSettings>) => void;
  setSoundCategoryEnabled: (cat: SoundCategory, enabled: boolean) => void;
  portalTeamId: string | null;
  setPortalTeamId: (teamId: string | null) => void;

  // Game Actions
  startWizard: () => Promise<void>;
  updateWizardStep: (step: number, data?: any) => Promise<void>;
  generateTeams: (leaderIds: string[]) => Promise<any>;
  finishWizard: (totalRounds: number, settings: any, approvedQuestions: Question[]) => Promise<void>;
  startCompetition: () => Promise<void>;
  evaluateRound: () => Promise<void>;
  continueNextRound: () => Promise<{ success: boolean; error?: string }>;
  quitToStartMenu: () => Promise<void>;

  saveGame: () => Promise<void>;
  loadGame: (gameId: string) => Promise<void>;
  togglePause: () => Promise<void>;
  endGame: () => Promise<void>;
  submitAnswer: (
    teamId: string,
    answer: string,
    studentId?: string,
    studentName?: string
  ) => Promise<{ success: boolean; revealed?: boolean; isCorrect?: boolean; points?: number; error?: string }>;
  drawGiftPlayer: (
    teamId: string,
    cardId: string,
    targetTeamId: string
  ) => Promise<{ success: boolean; draft?: GiftDraft; error?: string }>;
  playCard: (
    teamId: string,
    cardId: string,
    targetTeamId?: string,
    targetStudentId?: string,
    exchangeStudentId?: string,
    requestId?: string
  ) => Promise<{ success: boolean; effect?: Record<string, any>; error?: string }>;
  reactToCard: (
    reactionId: string,
    teamId: string,
    defenseCardType: CardType
  ) => Promise<{ success: boolean; reaction?: any; error?: string }>;
  claimCard: (teamId: string) => Promise<{ success: boolean; card?: CardInstance; error?: string }>;
  renameTeam: (teamId: string, name: string) => Promise<void>;
  updateSettings: (settings: Partial<GameSettings>) => Promise<void>;

  // New Features Actions
  dismissRivalry: () => Promise<void>;
  startComebackQuestion: () => Promise<void>;
  skipComebackBonus: () => Promise<void>;
  submitComebackAnswer: (
    teamId: string,
    answer: string
  ) => Promise<{ success: boolean; isCorrect?: boolean; rewardAwarded?: number; error?: string }>;
  skipCeremony: () => Promise<void>;
  completeCeremony: () => Promise<void>;

  // Team Notifications Center Actions
  fetchTeamNotifications: (
    teamId: string,
    opts?: { category?: string; unreadOnly?: boolean; limit?: number; offset?: number }
  ) => Promise<{ notifications: TeamNotification[]; unreadCount: number; totalCount: number } | null>;
  markNotificationRead: (teamId: string, notificationId: string) => Promise<boolean>;
  markAllNotificationsRead: (teamId: string) => Promise<number>;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

function isMobilePortalRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.pathname.startsWith('/play') ||
    window.location.search.includes('portal=team') ||
    window.location.search.includes('gameId=')
  );
}

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<GameState | null>(null);
  const [language, setLanguage] = useState<Language>('en');
  const [connected, setConnected] = useState<boolean>(false);
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(() => soundEffects.getSettings());
  const [portalTeamId, setPortalTeamIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('codearena_active_team_id');
    }
    return null;
  });

  useEffect(() => {
    const unsub = soundEffects.subscribe(() => {
      setSoundSettings(soundEffects.getSettings());
    });
    return unsub;
  }, []);

  // Autoplay unlock on Teacher Dashboard first user gesture (never on mobile portal)
  useEffect(() => {
    if (typeof window === 'undefined' || isMobilePortalRoute()) return;
    const handleUnlock = () => {
      soundEffects.unlockAudio();
    };
    window.addEventListener('pointerdown', handleUnlock, { passive: true });
    window.addEventListener('keydown', handleUnlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleUnlock);
      window.removeEventListener('keydown', handleUnlock);
    };
  }, []);

  const setPortalTeamId = useCallback((teamId: string | null) => {
    setPortalTeamIdState(teamId);
    if (typeof window !== 'undefined') {
      if (teamId) {
        localStorage.setItem('codearena_active_team_id', teamId);
      } else {
        localStorage.removeItem('codearena_active_team_id');
      }
    }
  }, []);

  // Connect to SSE event stream (team-scoped on mobile portal, full on teacher suite)
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    const mobile = isMobilePortalRoute();
    const query = mobile
      ? `?portal=team${portalTeamId ? `&teamId=${encodeURIComponent(portalTeamId)}` : ''}`
      : '';

    const connectSSE = () => {
      try {
        eventSource = new EventSource(`/api/events${query}`);

        eventSource.onopen = () => {
          setConnected(true);
        };

        eventSource.onmessage = event => {
          try {
            const data: GameState = JSON.parse(event.data);
            setState(data);
            if (!mobile) {
              soundEffects.processSoundEvents(data.soundEvents);
            }
          } catch (e) {
            console.error('Failed to parse SSE payload:', e);
          }
        };

        eventSource.onerror = () => {
          setConnected(false);
          if (eventSource) {
            eventSource.close();
          }
          reconnectTimeout = setTimeout(connectSSE, 3000);
        };
      } catch (err) {
        console.error('SSE initialization error:', err);
        reconnectTimeout = setTimeout(connectSSE, 3000);
      }
    };

    fetch(`/api/game${query}`)
      .then(res => res.json())
      .then((data: GameState) => {
        setState(data);
        setConnected(true);
        if (!mobile) {
          soundEffects.seedInitialEvents(data.soundEvents);
        }
      })
      .catch(err => console.error('Initial game fetch error:', err));

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      clearTimeout(reconnectTimeout);
    };
  }, [portalTeamId]);

  const toggleMute = useCallback(() => {
    soundEffects.unlockAudio();
    soundEffects.toggleMute();
  }, []);

  const updateSoundSettings = useCallback((partial: Partial<SoundSettings>) => {
    soundEffects.unlockAudio();
    soundEffects.updateSettings(partial);
  }, []);

  const setSoundCategoryEnabled = useCallback((cat: SoundCategory, enabled: boolean) => {
    soundEffects.unlockAudio();
    soundEffects.setCategoryEnabled(cat, enabled);
  }, []);

  const startWizard = useCallback(async () => {
    const res = await fetch('/api/game/wizard/start', { method: 'POST' });
    const data = await res.json();
    setState(data);
  }, []);

  const updateWizardStep = useCallback(async (step: number, data?: any) => {
    const res = await fetch('/api/game/wizard/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, ...data }),
    });
    const updated = await res.json();
    setState(updated);
  }, []);

  const generateTeams = useCallback(async (leaderIds: string[]) => {
    const res = await fetch('/api/game/wizard/generate-teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leaderIds }),
    });
    const result = await res.json();
    if (result.game) {
      setState(result.game);
    }
    return result;
  }, []);

  const finishWizard = useCallback(async (totalRounds: number, settings: any, approvedQuestions: Question[]) => {
    const res = await fetch('/api/game/wizard/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalRounds, settings, approvedQuestions }),
    });
    const data = await res.json();
    if (res.ok) {
      setState(data);
    }
  }, []);

  const startCompetition = useCallback(async () => {
    soundEffects.unlockAudio();
    const res = await fetch('/api/game/start-competition', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setState(data);
      if (!isMobilePortalRoute()) {
        soundEffects.processSoundEvents(data.soundEvents);
      }
    }
  }, []);

  const evaluateRound = useCallback(async () => {
    const res = await fetch('/api/game/round/evaluate', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setState(data);
      if (!isMobilePortalRoute()) {
        soundEffects.processSoundEvents(data.soundEvents);
      }
    }
  }, []);

  const continueNextRound = useCallback(async () => {
    const res = await fetch('/api/game/round/continue', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setState(data);
      if (!isMobilePortalRoute()) {
        soundEffects.processSoundEvents(data.soundEvents);
      }
      return { success: true };
    }
    return { success: false, error: data.error || 'Could not advance round.' };
  }, []);

  const quitToStartMenu = useCallback(async () => {
    const res = await fetch('/api/game/quit', { method: 'POST' });
    const data = await res.json();
    setState(data);
  }, []);

  const saveGame = useCallback(async () => {
    await fetch('/api/game/save', { method: 'POST' });
  }, []);

  const loadGame = useCallback(async (gameId: string) => {
    const res = await fetch('/api/game/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId }),
    });
    if (res.ok) {
      const data = await res.json();
      soundEffects.resetEventDedupe();
      soundEffects.seedInitialEvents(data.soundEvents);
      setState(data);
    }
  }, []);

  const togglePause = useCallback(async () => {
    await fetch('/api/game/pause', { method: 'POST' });
  }, []);

  const endGame = useCallback(async () => {
    const res = await fetch('/api/game/end', { method: 'POST' });
    const data = await res.json();
    setState(data);
    if (!isMobilePortalRoute()) {
      soundEffects.processSoundEvents(data.soundEvents);
    }
  }, []);

  const getMobileAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('codearena_auth');
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.token) {
          headers.Authorization = `Bearer ${parsed.token}`;
        }
      } catch {
        // Ignore storage errors
      }
    }
    return headers;
  };

  // Mobile Portal actions intentionally NEVER trigger client-side sound effects
  const submitAnswer = useCallback(
    async (teamId: string, answer: string, studentId?: string, studentName?: string) => {
      try {
        const res = await fetch('/api/game/answer', {
          method: 'POST',
          headers: getMobileAuthHeaders(),
          body: JSON.stringify({ teamId, answer, studentId, studentName }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.error || 'Failed to submit' };
        }
        return {
          success: true,
          revealed: !!data.revealed,
          isCorrect: data.submission?.isCorrect,
          points: data.submission?.pointsAwarded,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    []
  );

  const drawGiftPlayer = useCallback(async (teamId: string, cardId: string, targetTeamId: string) => {
    try {
      const res = await fetch('/api/game/card/gift/draw', {
        method: 'POST',
        headers: getMobileAuthHeaders(),
        body: JSON.stringify({ teamId, cardId, targetTeamId }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to draft player' };
      }
      return { success: true, draft: data.draft };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  const playCard = useCallback(
    async (
      teamId: string,
      cardId: string,
      targetTeamId?: string,
      targetStudentId?: string,
      exchangeStudentId?: string,
      requestId?: string
    ) => {
      try {
        const res = await fetch('/api/game/card/play', {
          method: 'POST',
          headers: getMobileAuthHeaders(),
          body: JSON.stringify({
            teamId,
            cardId,
            targetTeamId,
            targetStudentId,
            exchangeStudentId,
            requestId,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.error || 'Could not play card' };
        }
        return { success: true, effect: data.effect };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    []
  );

  const reactToCard = useCallback(async (reactionId: string, teamId: string, defenseCardType: CardType) => {
    try {
      const res = await fetch('/api/game/card/react', {
        method: 'POST',
        headers: getMobileAuthHeaders(),
        body: JSON.stringify({ reactionId, teamId, defenseCardType }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error };
      }
      return { success: true, reaction: data.reaction };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  const claimCard = useCallback(async (teamId: string) => {
    try {
      const res = await fetch('/api/game/card/claim', {
        method: 'POST',
        headers: getMobileAuthHeaders(),
        body: JSON.stringify({ teamId }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error };
      }
      return { success: true, card: data.card };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  const renameTeam = useCallback(async (teamId: string, name: string) => {
    await fetch('/api/game/teams/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, name }),
    });
  }, []);

  const updateSettings = useCallback(async (settings: Partial<GameSettings>) => {
    await fetch('/api/game/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  }, []);

  const dismissRivalry = useCallback(async () => {
    await fetch('/api/game/rivalry/dismiss', { method: 'POST' });
  }, []);

  const startComebackQuestion = useCallback(async () => {
    const res = await fetch('/api/game/comeback/start', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setState(data);
      if (!isMobilePortalRoute()) {
        soundEffects.processSoundEvents(data.soundEvents);
      }
    }
  }, []);

  const skipComebackBonus = useCallback(async () => {
    const res = await fetch('/api/game/comeback/skip', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setState(data);
    }
  }, []);

  const submitComebackAnswer = useCallback(async (teamId: string, answer: string) => {
    try {
      const res = await fetch('/api/game/comeback/answer', {
        method: 'POST',
        headers: getMobileAuthHeaders(),
        body: JSON.stringify({ teamId, answer }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Could not submit Comeback answer' };
      }
      return {
        success: true,
        isCorrect: data.isCorrect,
        rewardAwarded: data.rewardAwarded,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  const skipCeremony = useCallback(async () => {
    const res = await fetch('/api/game/ceremony/skip', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.ceremony) {
        setState(prev => (prev ? { ...prev, ceremony: data.ceremony } : prev));
      }
    }
  }, []);

  const completeCeremony = useCallback(async () => {
    const res = await fetch('/api/game/ceremony/complete', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.ceremony) {
        setState(prev => (prev ? { ...prev, ceremony: data.ceremony } : prev));
      }
    }
  }, []);

  const fetchTeamNotifications = useCallback(
    async (
      teamId: string,
      opts?: { category?: string; unreadOnly?: boolean; limit?: number; offset?: number }
    ) => {
      try {
        const params = new URLSearchParams({ teamId });
        if (opts?.category) params.set('category', opts.category);
        if (opts?.unreadOnly) params.set('unreadOnly', 'true');
        if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
        if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
        const res = await fetch(`/api/game/notifications?${params.toString()}`, {
          headers: getMobileAuthHeaders(),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          notifications: data.notifications || [],
          unreadCount: data.unreadCount ?? 0,
          totalCount: data.totalCount ?? 0,
        };
      } catch {
        return null;
      }
    },
    []
  );

  const markNotificationRead = useCallback(async (teamId: string, notificationId: string) => {
    const readAt = Date.now();
    setState(prev => {
      if (!prev?.notificationsByTeam?.[teamId]) return prev;
      return {
        ...prev,
        notificationsByTeam: {
          ...prev.notificationsByTeam,
          [teamId]: prev.notificationsByTeam[teamId].map(n =>
            n.id === notificationId ? { ...n, read: true, readAt: n.readAt || readAt } : n
          ),
        },
      };
    });
    try {
      const res = await fetch('/api/game/notifications/read', {
        method: 'POST',
        headers: getMobileAuthHeaders(),
        body: JSON.stringify({ teamId, notificationId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const markAllNotificationsRead = useCallback(async (teamId: string) => {
    const readAt = Date.now();
    setState(prev => {
      if (!prev?.notificationsByTeam?.[teamId]) return prev;
      return {
        ...prev,
        notificationsByTeam: {
          ...prev.notificationsByTeam,
          [teamId]: prev.notificationsByTeam[teamId].map(n =>
            n.read ? n : { ...n, read: true, readAt }
          ),
        },
      };
    });
    try {
      const res = await fetch('/api/game/notifications/read-all', {
        method: 'POST',
        headers: getMobileAuthHeaders(),
        body: JSON.stringify({ teamId }),
      });
      if (!res.ok) return 0;
      const data = await res.json();
      return data.markedCount ?? 0;
    } catch {
      return 0;
    }
  }, []);

  return (
    <GameContext.Provider
      value={{
        state,
        language,
        setLanguage,
        connected,
        isMuted: soundSettings.isMuted,
        toggleMute,
        soundSettings,
        updateSoundSettings,
        setSoundCategoryEnabled,
        portalTeamId,
        setPortalTeamId,
        startWizard,
        updateWizardStep,
        generateTeams,
        finishWizard,
        startCompetition,
        evaluateRound,
        continueNextRound,
        quitToStartMenu,
        saveGame,
        loadGame,
        togglePause,
        endGame,
        submitAnswer,
        drawGiftPlayer,
        playCard,
        reactToCard,
        claimCard,
        renameTeam,
        updateSettings,
        dismissRivalry,
        startComebackQuestion,
        skipComebackBonus,
        submitComebackAnswer,
        skipCeremony,
        completeCeremony,
        fetchTeamNotifications,
        markNotificationRead,
        markAllNotificationsRead,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}
