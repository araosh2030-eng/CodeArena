import React, { useState, useEffect } from 'react';
import { useGame } from '../../context/GameContext';
import { CardInstance, CardType } from '../../types/game';
import { OrientationGuard } from './OrientationGuard';
import { TeamSelectScreen } from './TeamSelectScreen';
import { AnswerPanel } from './AnswerPanel';
import { AnswerFeedback } from './AnswerFeedback';
import { TeamOverviewSidebar } from './TeamOverviewSidebar';
import { NotificationToastBanner } from './NotificationToastBanner';
import { NotificationCenterDrawer } from './NotificationCenterDrawer';
import { useTeamNotifications } from '../../hooks/useTeamNotifications';
import { CardInventory } from '../Cards/CardInventory';
import { CardRevealAnimation } from '../Cards/CardRevealAnimation';
import { CardActionModal, ReactionWindowModal } from '../Cards/CardActionModal';
import {
  Smartphone,
  Shield,
  Flame,
  AlertTriangle,
  LogOut,
  Users,
  Layers,
  ArrowLeftRight,
  Clock,
  Wifi,
  WifiOff,
  CheckCircle2,
  X,
  Zap,
  Send,
  Bell
} from 'lucide-react';

interface StoredAuth {
  user: { id: string; email: string; displayName?: string };
  token: string;
}

export const TeamMobilePortal: React.FC = () => {
  const {
    state,
    language,
    setLanguage,
    connected,
    portalTeamId,
    setPortalTeamId,
    submitAnswer,
    submitComebackAnswer,
    drawGiftPlayer,
    playCard,
    reactToCard,
    claimCard,
    markNotificationRead,
    markAllNotificationsRead,
  } = useGame();

  // Independent User Auth State
  const [auth, setAuth] = useState<StoredAuth | null>(() => {
    try {
      const raw = localStorage.getItem('codearena_auth');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [isRegisterMode, setIsRegisterMode] = useState<boolean>(false);
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authDisplayName, setAuthDisplayName] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthBusy, setIsAuthBusy] = useState<boolean>(false);

  // Team Notifications Center Drawer & Hook (unconditional top-level hook call)
  const [notifDrawerOpen, setNotifDrawerOpen] = useState<boolean>(false);
  const controlledTeamId =
    auth &&
    portalTeamId &&
    state?.teams?.[portalTeamId]?.activeSession?.userId === auth.user.id
      ? portalTeamId
      : null;

  const {
    notifications,
    unreadCount,
    activeToast,
    queuedCount,
    dismissToast,
    markRead: markTeamNotifRead,
    markAllRead: markAllTeamNotifsRead,
    preferences: notifPreferences,
    updatePreferences: updateNotifPreferences,
  } = useTeamNotifications({
    teamId: controlledTeamId,
    state,
    markNotificationRead,
    markAllNotificationsRead,
  });

  // Landscape HUD Sidebars (auto-open only on wide desktop/tablet, non-overlapping in-flow on landscape)
  const [leftOpen, setLeftOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false
  );
  const [rightOpen, setRightOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1180 : false
  );

  const toggleLeftSidebar = () => {
    setLeftOpen(prev => {
      const next = !prev;
      if (next && typeof window !== 'undefined' && window.innerWidth < 980) {
        setRightOpen(false);
      }
      return next;
    });
  };

  const toggleRightSidebar = () => {
    setRightOpen(prev => {
      const next = !prev;
      if (next && typeof window !== 'undefined' && window.innerWidth < 980) {
        setLeftOpen(false);
      }
      return next;
    });
  };

  // Answering State
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [textAnswer, setTextAnswer] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Card Modals & Reveal Animation State
  const [revealedCard, setRevealedCard] = useState<CardInstance | null>(null);
  const [activeCardToPlay, setActiveCardToPlay] = useState<CardInstance | null>(null);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [cardError, setCardError] = useState<string | null>(null);

  // Comeback Bonus Answering State
  const [comebackOption, setComebackOption] = useState<string>('');
  const [comebackText, setComebackText] = useState<string>('');
  const [isSubmittingComeback, setIsSubmittingComeback] = useState<boolean>(false);
  const [comebackError, setComebackError] = useState<string | null>(null);

  // Live countdown display in Top Bar
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!state) return;
    const tick = setInterval(() => {
      const now = Date.now();
      if (state.roundPhase === 'card_window' && state.cardWindowEndsAt) {
        setSecondsRemaining(Math.max(0, Math.ceil((state.cardWindowEndsAt - now) / 1000)));
      } else if (state.roundPhase === 'question_active' && state.questionTimerEndsAt) {
        setSecondsRemaining(Math.max(0, Math.ceil((state.questionTimerEndsAt - now) / 1000)));
      } else {
        setSecondsRemaining(null);
      }
    }, 250);
    return () => clearInterval(tick);
  }, [state?.roundPhase, state?.cardWindowEndsAt, state?.questionTimerEndsAt]);

  // Reset answer inputs on new round or new Comeback Bonus event
  useEffect(() => {
    setSelectedOption('');
    setTextAnswer('');
    setSubmitError(null);
  }, [state?.currentRoundNumber]);

  useEffect(() => {
    setComebackOption('');
    setComebackText('');
    setComebackError(null);
  }, [state?.comebackBonus?.activeEvent?.id]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthBusy(true);

    try {
      const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
          displayName: isRegisterMode ? authDisplayName : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed.');
      } else {
        const nextAuth: StoredAuth = { user: data.user, token: data.token };
        setAuth(nextAuth);
        localStorage.setItem('codearena_auth', JSON.stringify(nextAuth));
      }
    } catch (err: any) {
      setAuthError(err.message || 'Network error');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleSwitchTeam = async () => {
    if (portalTeamId && auth) {
      await fetch('/api/game/team/leave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ teamId: portalTeamId, userId: auth.user.id }),
      }).catch(() => {});
    }
    setPortalTeamId(null);
  };

  const handleLogout = async () => {
    await handleSwitchTeam();
    setAuth(null);
    localStorage.removeItem('codearena_auth');
  };

  // 1. Auth Screen (Completely decoupled from 22-student roster)
  if (!auth) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-gradient-to-tr from-cyan-500 to-indigo-600 rounded-2xl mx-auto flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
              <Smartphone className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-black text-white">CodeArena Team Portal</h1>
            <p className="text-xs text-slate-400">
              Sign in or create an account with your email and password, then choose your competition team.
            </p>
          </div>

          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setIsRegisterMode(false);
                setAuthError(null);
              }}
              className={`w-1/2 py-2 rounded-lg transition-all ${
                !isRegisterMode ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegisterMode(true);
                setAuthError(null);
              }}
              className={`w-1/2 py-2 rounded-lg transition-all ${
                isRegisterMode ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-rose-950 border border-rose-700 text-rose-200 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-3">
            {isRegisterMode && (
              <div className="space-y-1">
                <label htmlFor="auth-display-name" className="text-xs font-bold text-slate-300 block">
                  Display Name (Optional)
                </label>
                <input
                  id="auth-display-name"
                  type="text"
                  value={authDisplayName}
                  onChange={e => setAuthDisplayName(e.target.value)}
                  placeholder="e.g. Alex"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none"
                />
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="auth-email" className="text-xs font-bold text-slate-300 block">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                required
                placeholder="leader@school.edu"
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="auth-password" className="text-xs font-bold text-slate-300 block">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                required
                minLength={4}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={isAuthBusy}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 text-white font-black text-xs shadow-lg"
            >
              {isAuthBusy
                ? 'Please wait...'
                : isRegisterMode
                ? 'Register & Continue'
                : 'Sign In & Select Team'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 2. Post-Login Team Selection Screen
  const activeTeam = portalTeamId && state?.teams ? state.teams[portalTeamId] : undefined;
  if (!portalTeamId || !activeTeam) {
    return (
      <TeamSelectScreen
        user={auth.user}
        token={auth.token}
        onTeamJoined={tid => setPortalTeamId(tid)}
        onLogout={handleLogout}
      />
    );
  }

  // 2b. Session Replaced / Invalidated Guard (when another device takes over this team)
  if (!activeTeam.activeSession || activeTeam.activeSession.userId !== auth.user.id) {
    const takenBy =
      activeTeam.activeSession?.operatorName || activeTeam.activeSession?.userEmail || 'Another device';
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-slate-900 border border-rose-700/70 rounded-3xl p-6 shadow-2xl space-y-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-rose-950 border border-rose-700 text-rose-400 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-black text-white">Team Controller Session Replaced</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            {activeTeam.activeSession
              ? `${activeTeam.name} is now controlled by ${takenBy}. Your device no longer has active controller permission.`
              : `Your controller session for ${activeTeam.name} is no longer active.`}
          </p>
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={() => setPortalTeamId(null)}
              className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-black text-xs"
            >
              Return to Team Selection
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const team = activeTeam;
  const currentAnswer = state?.answers?.[team.id];
  const hasSubmitted = !!currentAnswer;

  const isPrivateRound = state?.currentRoundType === 'private_round';
  const privateSelected = isPrivateRound
    ? state?.privateRoundGroup?.selectedPlayerPerTeam?.[team.id]
    : null;

  const incomingReaction = state?.activeReactions?.find(
    r =>
      r.targetTeamId === team.id &&
      (r.status === 'pending' || r.status === 'waiting_for_response')
  );

  const recentResolvedReaction = state?.activeReactions
    ?.slice()
    .reverse()
    .find(
      r =>
        (r.targetTeamId === team.id || r.initiatingTeamId === team.id) &&
        (r.status === 'defended' || r.status === 'executed' || r.status === 'cancelled') &&
        r.resultMessageEn
    );

  const activeComeback = state?.comebackBonus?.activeEvent;

  const handleSubmitComebackAnswer = async () => {
    const finalAnswer = comebackOption || comebackText.trim();
    if (!finalAnswer || !activeComeback) return;
    setComebackError(null);
    setIsSubmittingComeback(true);
    const res = await submitComebackAnswer(team.id, finalAnswer);
    setIsSubmittingComeback(false);
    if (!res.success) {
      setComebackError(res.error || 'Could not submit Comeback answer.');
    }
  };

  const handleSubmitAnswer = async () => {
    const finalAnswer = selectedOption || textAnswer.trim();
    if (!finalAnswer) return;
    setSubmitError(null);
    setIsSubmitting(true);
    const res = await submitAnswer(
      team.id,
      finalAnswer,
      privateSelected?.studentId || team.leaderStudentId,
      privateSelected?.name || team.leaderName
    );
    setIsSubmitting(false);
    if (!res.success) {
      setSubmitError(res.error || 'Submission rejected by server.');
    }
  };

  const handleClaimCard = async () => {
    setCardError(null);
    setIsClaiming(true);
    const res = await claimCard(team.id);
    setIsClaiming(false);
    if (!res.success) {
      setCardError(res.error || 'Unable to draw card.');
    } else if (res.card) {
      setRevealedCard(res.card);
    }
  };

  const handleDefend = async (defenseCardType: CardType) => {
    if (!incomingReaction) return;
    await reactToCard(incomingReaction.id, team.id, defenseCardType);
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col select-none">
      <OrientationGuard />

      {/* Top Landscape Gaming HUD Bar */}
      <header className="h-14 shrink-0 bg-slate-900 border-b border-slate-800 px-3 sm:px-4 flex items-center justify-between gap-2 z-30">
        {/* Left: Brand + Sidebar Toggle + Team/Leader Badge */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={toggleLeftSidebar}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              leftOpen
                ? 'bg-cyan-600 border-cyan-400 text-white'
                : 'bg-slate-800 border-slate-700 text-cyan-300 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Cards ({team.secretCards.length})</span>
            {team.pointsAccumulatedForCards > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            )}
          </button>

          <div
            className="flex items-center gap-2 pl-2 border-l border-slate-800 min-w-0"
            style={{ borderLeftColor: team.color }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm text-white truncate">{team.name}</span>
                {team.streak >= 3 && (
                  <span className="px-1.5 py-0.2 rounded bg-amber-950 border border-amber-700 text-amber-300 text-[10px] font-mono font-black flex items-center gap-0.5 shrink-0">
                    <Flame className="w-3 h-3 text-amber-400" />
                    <span>x{team.streak}</span>
                  </span>
                )}
              </div>
              <span className="block text-[10px] text-slate-400 truncate">
                Official Leader: <strong className="text-slate-200">{team.leaderName}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Center: Round & Score HUD */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono font-bold text-slate-200 whitespace-nowrap">
            R{state?.currentRoundNumber || 1}/{state?.totalRounds || 50}
          </div>

          {secondsRemaining !== null && (
            <div
              className={`px-2.5 py-1 rounded-xl border text-xs font-mono font-black flex items-center gap-1 tabular-nums whitespace-nowrap ${
                secondsRemaining <= 10
                  ? 'bg-rose-950 border-rose-600 text-rose-300'
                  : 'bg-slate-950 border-slate-700 text-cyan-300'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{secondsRemaining}s</span>
            </div>
          )}

          <div className="px-3 py-1 rounded-xl bg-cyan-950/70 border border-cyan-500/40 text-xs font-mono font-black text-cyan-300 tabular-nums whitespace-nowrap">
            {team.score} PTS
          </div>
        </div>

        {/* Right: Teams Toggle + Notifications Bell + Live Status + Switch Team + Sign Out */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={toggleRightSidebar}
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              rightOpen
                ? 'bg-indigo-600 border-indigo-400 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Teams</span>
          </button>

          <button
            type="button"
            onClick={() => setNotifDrawerOpen(prev => !prev)}
            data-testid="notification-bell-btn"
            aria-label={language === 'ar' ? 'مركز الإشعارات' : 'Open Notification Center'}
            className={`relative min-w-[36px] min-h-[34px] px-2 py-1.5 rounded-xl border flex items-center justify-center transition-colors ${
              notifDrawerOpen
                ? 'bg-cyan-600 border-cyan-400 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:text-white'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            {unreadCount > 0 && (
              <span
                data-testid="notification-unread-badge"
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 border border-slate-950 text-[10px] font-mono font-black text-white flex items-center justify-center leading-none tabular-nums"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          <span
            className={`p-1.5 rounded-lg border ${
              connected
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-400'
                : 'bg-rose-950/60 border-rose-800 text-rose-400'
            }`}
            title={connected ? 'Real-Time Connected' : 'Reconnecting...'}
          >
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          </span>

          <button
            type="button"
            onClick={handleSwitchTeam}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
            title="Switch Team"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900 text-slate-300 hover:text-white"
            title="Sign Out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main 3-Zone Landscape Arena */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Left Collapsible Sidebar: Secret Card Inventory (in-flow on >=640px landscape so center never overlaps) */}
        {leftOpen && (
          <aside className="w-56 sm:w-60 md:w-64 lg:w-72 shrink-0 bg-slate-900/95 border-r border-slate-800 p-2.5 sm:p-3 z-20 flex flex-col overflow-hidden shadow-2xl max-sm:absolute max-sm:inset-y-0 max-sm:left-0 max-sm:w-64">
            <div className="flex items-center justify-between lg:hidden mb-2 pb-1.5 border-b border-slate-800">
              <span className="text-xs font-black text-cyan-300">Secret Cards</span>
              <button
                type="button"
                onClick={() => setLeftOpen(false)}
                aria-label="Close Secret Cards"
                className="p-1 rounded-lg bg-slate-800 text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {cardError && (
              <div className="mb-2 p-2 rounded-xl bg-rose-950 border border-rose-700 text-[11px] text-rose-200">
                {cardError}
              </div>
            )}
            <CardInventory
              team={team}
              state={state!}
              onClaimCard={handleClaimCard}
              onSelectCardToUse={card => setActiveCardToPlay(card)}
              isClaiming={isClaiming}
            />
          </aside>
        )}

        {/* Center Primary Area: Answer Submission & Server-Confirmed Feedback */}
        <main className="flex-1 min-w-0 p-3 sm:p-4 flex flex-col space-y-2.5 overflow-y-auto">
          {recentResolvedReaction && (
            <div className="px-3 py-2 rounded-xl bg-slate-900 border border-cyan-500/40 text-xs text-cyan-200 flex items-center gap-2 shrink-0">
              <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
              <span className="truncate">{recentResolvedReaction.resultMessageEn}</span>
              <span className="ml-auto text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                {recentResolvedReaction.status}
              </span>
            </div>
          )}

          {submitError && (
            <div className="px-3 py-2 rounded-xl bg-rose-950 border border-rose-700 text-xs text-rose-200 flex items-center gap-2 shrink-0">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex-1 bg-slate-900/75 border border-slate-800 rounded-3xl p-3 sm:p-4 flex flex-col min-h-0 shadow-xl">
            {state && activeComeback ? (
              activeComeback.eligibleTeamId === team.id ? (
                <div className="flex-1 flex flex-col justify-between space-y-3">
                  <div className="flex items-center justify-between gap-2 bg-amber-950/60 border border-amber-500/60 rounded-2xl px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-amber-300 font-black text-xs">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span>COMEBACK BONUS OPPORTUNITY</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-lg bg-amber-500 text-slate-950 font-mono font-black text-xs">
                      +{activeComeback.rewardValue} PTS
                    </span>
                  </div>

                  {comebackError && (
                    <div className="px-3 py-2 rounded-xl bg-rose-950 border border-rose-700 text-xs text-rose-200 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{comebackError}</span>
                    </div>
                  )}

                  {activeComeback.status === 'announced' ? (
                    <div className="flex-1 rounded-2xl bg-slate-950/75 border border-amber-500/40 p-6 flex flex-col items-center justify-center text-center space-y-2">
                      <Zap className="w-9 h-9 text-amber-400 animate-pulse" />
                      <h4 className="text-lg font-black text-white">Your Team Qualified for Comeback Bonus!</h4>
                      <p className="text-xs text-slate-300 max-w-sm">
                        Waiting for host to reveal your +{activeComeback.rewardValue} PTS Comeback Question. Zero penalty if incorrect.
                      </p>
                    </div>
                  ) : activeComeback.status === 'question_active' && activeComeback.assignedQuestion ? (
                    <div className="flex-1 flex flex-col justify-between space-y-3">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>Look at the main screen for the Comeback Question</span>
                        <span>Zero Penalty if Wrong</span>
                      </div>

                      {activeComeback.assignedQuestion.options && activeComeback.assignedQuestion.options.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 content-center" dir="ltr">
                          {activeComeback.assignedQuestion.options.map((opt, idx) => {
                            const selected = comebackOption === opt;
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setComebackOption(opt)}
                                className={`min-h-[50px] px-3.5 py-2 rounded-2xl border-2 text-left flex items-center gap-3 transition-all ${
                                  selected
                                    ? 'bg-amber-600/25 border-amber-400 text-white'
                                    : 'bg-slate-950 border-slate-800 hover:border-slate-600 text-slate-200'
                                }`}
                              >
                                <span className={`w-7 h-7 rounded-xl flex items-center justify-center font-mono font-black text-xs shrink-0 ${
                                  selected ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-amber-300'
                                }`}>
                                  {['A', 'B', 'C', 'D'][idx] || idx + 1}
                                </span>
                                <span className="text-sm font-semibold break-words">{opt}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : activeComeback.assignedQuestion.type === 'true_false' ? (
                        <div className="grid grid-cols-2 gap-3 flex-1 items-center" dir="ltr">
                          {['True', 'False'].map(val => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setComebackOption(val)}
                              className={`min-h-[72px] rounded-2xl border-2 font-black text-lg transition-all ${
                                comebackOption === val
                                  ? 'bg-amber-500 text-slate-950 border-amber-300'
                                  : 'bg-slate-950 border-slate-800 hover:border-slate-600 text-slate-200'
                              }`}
                            >
                              {val}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <textarea
                          rows={4}
                          value={comebackText}
                          onChange={e => setComebackText(e.target.value)}
                          placeholder="Type your exact Comeback Bonus answer..."
                          className="flex-1 w-full bg-slate-950 border-2 border-slate-800 focus:border-amber-400 rounded-2xl p-3 font-mono text-sm text-amber-200 focus:outline-none resize-none"
                          dir="ltr"
                        />
                      )}

                      <button
                        type="button"
                        onClick={handleSubmitComebackAnswer}
                        disabled={isSubmittingComeback || (!comebackOption && !comebackText.trim())}
                        className="w-full min-h-[46px] py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-40 text-slate-950 font-black rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg"
                      >
                        <Send className="w-4 h-4" />
                        <span>{isSubmittingComeback ? 'Submitting...' : 'Submit Comeback Answer'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className={`flex-1 rounded-2xl border-2 p-6 flex flex-col items-center justify-center text-center space-y-2 ${
                      activeComeback.answerResult === 'correct'
                        ? 'bg-emerald-950/40 border-emerald-500/70'
                        : 'bg-slate-950/75 border-slate-700'
                    }`}>
                      <h4 className={`text-xl font-black ${activeComeback.answerResult === 'correct' ? 'text-emerald-300' : 'text-slate-200'}`}>
                        {activeComeback.answerResult === 'correct'
                          ? `Comeback Success! +${activeComeback.rewardValue} PTS!`
                          : 'Incorrect Comeback Answer — 0 Points (No Penalty)'}
                      </h4>
                      <p className="text-xs text-slate-400">
                        Waiting for host to launch the next round...
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 rounded-2xl bg-slate-950/75 border border-amber-600/40 p-6 flex flex-col items-center justify-center text-center space-y-2">
                  <Zap className="w-8 h-8 text-amber-400 animate-pulse" />
                  <h4 className="text-base font-black text-white">
                    Comeback Bonus in Progress for {activeComeback.eligibleTeamName}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-sm">
                    Between-round Comeback Bonus (+{activeComeback.rewardValue} PTS opportunity) is currently underway. Next round begins shortly.
                  </p>
                </div>
              )
            ) : state ? (
              hasSubmitted && currentAnswer ? (
                <AnswerFeedback state={state} team={team} submission={currentAnswer} />
              ) : (
                <AnswerPanel
                  state={state}
                  team={team}
                  selectedOption={selectedOption}
                  setSelectedOption={setSelectedOption}
                  textAnswer={textAnswer}
                  setTextAnswer={setTextAnswer}
                  isSubmitting={isSubmitting}
                  onSubmit={handleSubmitAnswer}
                />
              )
            ) : null}
          </div>
        </main>

        {/* Right Collapsible Sidebar: Teams & Public Player Protection */}
        {rightOpen && (
          <aside className="w-56 sm:w-60 md:w-64 lg:w-72 shrink-0 bg-slate-900/95 border-l border-slate-800 p-2.5 sm:p-3 z-20 flex flex-col overflow-hidden shadow-2xl max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:w-64">
            <div className="flex items-center justify-between lg:hidden mb-2 pb-1.5 border-b border-slate-800">
              <span className="text-xs font-black text-indigo-300">Teams & Shields</span>
              <button
                type="button"
                onClick={() => setRightOpen(false)}
                aria-label="Close Teams & Shields"
                className="p-1 rounded-lg bg-slate-800 text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {state && <TeamOverviewSidebar state={state} currentTeamId={team.id} />}
          </aside>
        )}
      </div>

      {/* 3D Card Reveal Flip Animation on Claim */}
      {revealedCard && (
        <CardRevealAnimation card={revealedCard} onClose={() => setRevealedCard(null)} />
      )}

      {/* Visual Interactive Card Action Modal */}
      {activeCardToPlay && state && (
        <CardActionModal
          card={activeCardToPlay}
          team={team}
          state={state}
          onClose={() => setActiveCardToPlay(null)}
          onDrawGiftPlayer={drawGiftPlayer}
          onExecuteCard={playCard}
        />
      )}

      {/* Automatic Incoming Reaction Window Modal */}
      {incomingReaction && (
        <ReactionWindowModal
          reaction={incomingReaction}
          team={team}
          currentRoundNumber={state?.currentRoundNumber || 1}
          onDefend={handleDefend}
        />
      )}

      {/* Floating Single-Banner Toast Alert (non-blocking top placement) */}
      {!notifDrawerOpen && (
        <NotificationToastBanner
          toast={activeToast}
          queuedCount={queuedCount}
          language={language}
          onDismiss={dismissToast}
          onOpenCenter={notif => {
            dismissToast();
            markTeamNotifRead(notif.id);
            setNotifDrawerOpen(true);
          }}
        />
      )}

      {/* Top-Right Slide-Over Notification Center Drawer */}
      <NotificationCenterDrawer
        isOpen={notifDrawerOpen}
        onClose={() => setNotifDrawerOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        language={language}
        onToggleLanguage={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
        onMarkRead={id => markTeamNotifRead(id)}
        onMarkAllRead={() => markAllTeamNotifsRead()}
        preferences={notifPreferences}
        onUpdatePreferences={updateNotifPreferences}
      />
    </div>
  );
};
