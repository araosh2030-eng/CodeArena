import React, { useState, useEffect } from 'react';
import { useGame } from '../../context/GameContext';
import { Question } from '../../types/game';
import { computeTeamRankings, evaluateQuestionAnswer } from '../../game/rules';
import { AIReviewWorkspace } from './AIReviewWorkspace';
import { LiveScoreboard } from './LiveScoreboard';
import { TeamRivalryOverlay } from './TeamRivalryOverlay';
import { ComebackBonusPanel } from './ComebackBonusPanel';
import { FinalCeremonyModal } from './FinalCeremonyModal';
import {
  Clock,
  Flame,
  Shield,
  Users,
  CheckCircle2,
  XCircle,
  Code2,
  Sparkles,
  ArrowRight,
  Pause,
  Play,
  Save,
  LogOut,
  Eye,
  History,
  QrCode,
  Menu,
  X,
  Database,
  Zap,
  TrendingDown,
  AlertTriangle,
  Trophy,
  RotateCcw,
  Flag,
  ChevronsUp
} from 'lucide-react';
import QRCode from 'qrcode';
import { GameCard } from '../Cards/GameCard';

export const UnifiedTeacherScreen: React.FC = () => {
  const {
    state,
    language,
    evaluateRound,
    continueNextRound,
    togglePause,
    saveGame,
    endGame,
    quitToStartMenu,
    dismissRivalry,
    startComebackQuestion,
    skipComebackBonus,
    skipCeremony,
    completeCeremony,
  } = useGame();

  const isAr = language === 'ar';
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [showAdminMenu, setShowAdminMenu] = useState<boolean>(false);
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [showBankModal, setShowBankModal] = useState<boolean>(false);
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [ceremonyClosedForGameId, setCeremonyClosedForGameId] = useState<string | null>(null);
  const [isReplayCeremony, setIsReplayCeremony] = useState<boolean>(false);

  const openBankManager = async () => {
    try {
      const res = await fetch('/api/questions');
      if (res.ok) {
        const list = await res.json();
        setBankQuestions(Array.isArray(list) ? list : []);
      }
    } catch {
      // Ignore fetch failure
    }
    setShowBankModal(true);
  };

  const handleUpdateBankQuestion = async (id: string, updates: Partial<Question>) => {
    setBankQuestions(prev => prev.map(q => (q.id === id ? { ...q, ...updates } : q)));
    await fetch(`/api/questions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).catch(() => {});
  };

  const handleReplaceBankQuestion = async (updated: Question) => {
    setBankQuestions(prev => prev.map(q => (q.id === updated.id ? updated : q)));
    await fetch(`/api/questions/${encodeURIComponent(updated.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});
  };

  const handleDeleteBankQuestion = async (id: string) => {
    setBankQuestions(prev => prev.filter(q => q.id !== id));
    await fetch(`/api/questions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  };

  // Live timer tick
  useEffect(() => {
    if (!state) return;

    const timer = setInterval(() => {
      const now = Date.now();
      if (state.roundPhase === 'card_window' && state.cardWindowEndsAt) {
        const diff = Math.max(0, Math.ceil((state.cardWindowEndsAt - now) / 1000));
        setSecondsRemaining(diff);
      } else if (state.roundPhase === 'question_active' && state.questionTimerEndsAt) {
        const diff = Math.max(0, Math.ceil((state.questionTimerEndsAt - now) / 1000));
        setSecondsRemaining(diff);
      } else {
        setSecondsRemaining(null);
      }
    }, 250);

    return () => clearInterval(timer);
  }, [state?.roundPhase, state?.cardWindowEndsAt, state?.questionTimerEndsAt]);

  // Generate QR code for emergency drawer
  useEffect(() => {
    if (state?.gameId) {
      const joinUrl = `${window.location.origin}/play?gameId=${state.gameId}`;
      QRCode.toDataURL(joinUrl, { width: 220, margin: 2, color: { dark: '#020617', light: '#ffffff' } })
        .then(setQrDataUrl)
        .catch(() => {});
    }
  }, [state?.gameId]);

  // Reset ceremony drawer tracking when switching games
  useEffect(() => {
    setCeremonyClosedForGameId(null);
    setIsReplayCeremony(false);
  }, [state?.gameId]);

  if (!state) return null;

  const rankings = computeTeamRankings(state.teams);
  const activeComeback = state.comebackBonus?.activeEvent;
  const shouldShowCeremonyModal =
    state.status === 'completed' &&
    (isReplayCeremony || ceremonyClosedForGameId !== state.gameId);

  const roundTypeNames: Record<string, { ar: string; en: string; color: string }> = {
    group_speed: {
      ar: 'جولة سرعة جماعية (Speed Round)',
      en: 'Group Speed Round',
      color: 'bg-amber-500 text-slate-950',
    },
    individual_teams: {
      ar: 'أسئلة فردية للفرق (Individual Questions)',
      en: 'Individual Questions',
      color: 'bg-indigo-500 text-white',
    },
    hidden_cards: {
      ar: 'كروت الأسئلة المقلوبة (Hidden Cards)',
      en: 'Hidden Cards Round',
      color: 'bg-purple-500 text-white',
    },
    collaborative_coding: {
      ar: 'تحدي البرمجة الجماعي (Collaborative Challenge)',
      en: 'Collaborative Coding Challenge',
      color: 'bg-rose-500 text-white',
    },
    private_round: {
      ar: 'جولة فردية خاصة (Private Round)',
      en: 'Private Player Round',
      color: 'bg-emerald-500 text-slate-950',
    },
  };

  const activeRoundMeta = roundTypeNames[state.currentRoundType] || roundTypeNames.group_speed;
  const isPrivateRound = state.currentRoundType === 'private_round';
  const isCardWindow = state.roundPhase === 'card_window';
  const isEvaluating = state.roundPhase === 'evaluating';
  const privateTeamOrder =
    state.privateRoundGroup?.teamOrder && state.privateRoundGroup.teamOrder.length > 0
      ? state.privateRoundGroup.teamOrder
      : Object.keys(state.teams);
  const activePrivateTurnIndex = state.privateRoundGroup?.activeTurnIndex ?? 0;
  const activePrivateTeamId = isPrivateRound ? privateTeamOrder[activePrivateTurnIndex] : undefined;
  const activePrivateTeam = activePrivateTeamId ? state.teams[activePrivateTeamId] : undefined;
  const activePrivateStudent = activePrivateTeamId
    ? state.privateRoundGroup?.selectedPlayerPerTeam?.[activePrivateTeamId]
    : undefined;
  const hasMorePrivateTurns = isPrivateRound && activePrivateTurnIndex < privateTeamOrder.length - 1;

  return (
    <div className="min-h-[calc(100vh-53px)] bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-5 select-none">
      <div className="w-full max-w-7xl mx-auto space-y-4">
        {/* Top Arena Navigation Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl backdrop-blur-md">
          {/* Match & Round info */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-black uppercase px-3 py-1 rounded-xl bg-cyan-950 text-cyan-300 border border-cyan-800 tracking-wider">
              {state.name}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xl md:text-2xl font-black text-white">
                {isAr ? `الجولة ${state.currentRoundNumber}` : `Round ${state.currentRoundNumber}`}
              </span>
              <span className="text-slate-500 font-mono text-sm">/ {state.totalRounds}</span>
            </div>
            <span className={`text-xs font-black uppercase px-3 py-1 rounded-xl shadow-md ${activeRoundMeta.color}`}>
              {isAr ? activeRoundMeta.ar : activeRoundMeta.en}
            </span>
          </div>

          {/* Central Timer & Phase */}
          <div className="flex items-center gap-3">
            {isCardWindow && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-950/90 border border-amber-600 text-amber-300 animate-pulse font-mono font-bold">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>{isAr ? 'نافذة الكروت:' : 'Card Window:'} {secondsRemaining ?? 20}s</span>
              </div>
            )}

            {!isCardWindow && secondsRemaining !== null && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border font-mono font-black ${
                secondsRemaining <= 10
                  ? 'bg-rose-950/90 border-rose-600 text-rose-300 animate-bounce'
                  : 'bg-slate-800 border-slate-700 text-cyan-300'
              }`}>
                <Clock className="w-4 h-4" />
                <span className="text-xl tabular-nums">{secondsRemaining}s</span>
              </div>
            )}

            {isPrivateRound && !isCardWindow && (
              <div className="px-3.5 py-1.5 rounded-xl bg-emerald-950/80 border border-emerald-700 text-emerald-300 text-xs font-bold flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span>{isAr ? 'لا يوجد مؤقت إجابة' : 'No Answer Timer'}</span>
              </div>
            )}

            {/* Teacher Drawer Button */}
            <button
              onClick={() => setShowAdminMenu(true)}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Admin Menu"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Live Real-Time Broadcast Scoreboard */}
        <LiveScoreboard state={state} isAr={isAr} />

        {/* Completed Match Banner (when Summary modal is closed) */}
        {state.status === 'completed' && (
          <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-slate-900 border border-amber-500/60 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-amber-200 font-black text-sm">
              <Trophy className="w-5 h-5 text-amber-400" />
              <span>Match Completed — Official Results Locked & Saved</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsReplayCeremony(false);
                  setCeremonyClosedForGameId(null);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white"
              >
                View Final Summary
              </button>
              <button
                type="button"
                onClick={() => {
                  setCeremonyClosedForGameId(null);
                  setIsReplayCeremony(true);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Replay Ceremony</span>
              </button>
            </div>
          </div>
        )}

        {/* Between-Round Comeback Bonus Panel */}
        {activeComeback && state.status !== 'completed' && (
          <ComebackBonusPanel
            activeEvent={activeComeback}
            onStartQuestion={startComebackQuestion}
            onSkip={skipComebackBonus}
            onContinueNextRound={continueNextRound}
          />
        )}
        {/* Private Round Highlight Banner (if in private round) */}
        {isPrivateRound && (
          <div className="bg-gradient-to-r from-emerald-950/90 via-slate-900 to-emerald-950/90 border border-emerald-600/70 rounded-3xl p-4 shadow-2xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-800/60 pb-2.5">
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                <Users className="w-5 h-5 text-emerald-400" />
                <span>
                  {isAr
                    ? `جولة فردية خاصة (${state.privateRoundGroup.roundIndexInBatch} من 5) — 4 أسئلة متتابعة (سؤال لكل طالب مختار)`
                    : `Private Round (${state.privateRoundGroup.roundIndexInBatch} of 5) — 4 Sequential Individual Questions`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {!isCardWindow && (
                  <span className="text-xs font-mono font-black text-cyan-300 bg-cyan-950 px-2.5 py-0.5 rounded-lg border border-cyan-700 tabular-nums">
                    Turn {activePrivateTurnIndex + 1} / {privateTeamOrder.length}
                  </span>
                )}
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded-lg border border-emerald-800">
                  Batch #{state.privateRoundGroup.batchNumber}
                </span>
              </div>
            </div>

            {state.privateRoundGroup.warnings && state.privateRoundGroup.warnings.length > 0 && (
              <div className="px-3 py-2 rounded-xl bg-amber-950/80 border border-amber-700 text-xs text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{state.privateRoundGroup.warnings.join(' ')}</span>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {privateTeamOrder.map((teamId, idx) => {
                const team = state.teams[teamId];
                if (!team) return null;
                const selected = state.privateRoundGroup.selectedPlayerPerTeam[teamId];
                const turnSub = state.privateRoundGroup.turnSubmissions?.[teamId];
                const isActiveTurn = !isCardWindow && idx === activePrivateTurnIndex;

                return (
                  <div
                    key={teamId}
                    className={`rounded-2xl p-3 border transition-all ${
                      isActiveTurn
                        ? 'bg-emerald-950/80 border-emerald-400 ring-2 ring-emerald-400/40 shadow-lg'
                        : turnSub
                        ? 'bg-slate-950/90 border-slate-700'
                        : 'bg-slate-950/60 border-slate-800/80 opacity-85'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold text-slate-400 truncate">
                        #{idx + 1} • {team.name}
                      </span>
                      {isActiveTurn ? (
                        <span className="text-[10px] font-mono font-black text-emerald-300 uppercase">
                          Active
                        </span>
                      ) : turnSub ? (
                        <span
                          className={`text-[10px] font-mono font-bold ${
                            turnSub.isCorrect ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {turnSub.isCorrect ? `+${turnSub.pointsAwarded}` : 'Wrong'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-500">Queued</span>
                      )}
                    </div>
                    <div className="text-sm font-black text-white flex items-center gap-1.5 mt-1 truncate">
                      {isActiveTurn && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                      )}
                      <span className="truncate">{selected ? selected.name : 'Selecting...'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Card Selection Waiting State (HIDE QUESTION COMPLETELY DURING card_window / idle) */}
        {(isCardWindow || state.roundPhase === 'idle') && (
          <div className="bg-slate-900 border border-amber-500/40 rounded-3xl p-8 sm:p-10 shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 mx-auto flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-amber-400 animate-pulse" />
            </div>
            <div className="space-y-1.5 max-w-xl mx-auto">
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-amber-300 block">
                {isAr ? 'تجهيز الجولة' : 'Preparing Round'}
              </span>
              <h2 className="text-2xl md:text-3xl font-black text-white">
                {isAr ? 'نافذة استخدام الكروت السرية' : 'Card Selection Window'}
              </h2>
              <p className="text-sm text-slate-300">
                {isAr
                  ? 'السؤال مخفي مؤقتاً حتى تنتهي مهلة استخدام الكروت لدى قادة الفرق.'
                  : 'The upcoming question is hidden while teams play strategic cards on their mobile devices.'}
              </p>
            </div>
            {secondsRemaining !== null && (
              <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-amber-950/90 border border-amber-600 text-amber-200 font-mono font-black text-xl tabular-nums">
                <Clock className="w-5 h-5 text-amber-400" />
                <span>{secondsRemaining}s</span>
              </div>
            )}
          </div>
        )}

        {/* Live Question Presentation Card (REVEALED ONLY IN question_active / evaluating / round_ended) */}
        {!isCardWindow && state.roundPhase !== 'idle' && state.currentQuestion && (
          <div className="bg-slate-900 border-2 border-slate-700/80 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
            {isPrivateRound && activePrivateTeam && activePrivateStudent && (
              <div className="mb-4 px-4 py-2.5 rounded-2xl bg-emerald-950/70 border border-emerald-600/70 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs sm:text-sm font-bold text-emerald-200">
                  Turn {activePrivateTurnIndex + 1} of {privateTeamOrder.length}:{' '}
                  <span className="text-white font-black">{activePrivateStudent.name}</span>{' '}
                  <span className="text-emerald-400">({activePrivateTeam.name})</span>
                </div>
                <span className="text-[11px] font-mono text-emerald-300">
                  Answering Solo • No Timer
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold px-2.5 py-1 rounded-md bg-cyan-950 text-cyan-300 border border-cyan-800 uppercase">
                  {(state.currentQuestion.type || 'multiple_choice').replace(/_/g, ' ')}
                </span>
                {state.currentQuestion.programmingLanguage && (
                  <span className="font-mono font-bold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center gap-1">
                    <Code2 className="w-3 h-3" />
                    <span>{state.currentQuestion.programmingLanguage}</span>
                  </span>
                )}
                <span className={`font-bold px-2 py-0.5 rounded uppercase ${
                  state.currentQuestion.difficulty === 'hard' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                  state.currentQuestion.difficulty === 'medium' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                  'bg-emerald-950 text-emerald-300 border border-emerald-800'
                }`}>
                  {state.currentQuestion.difficulty}
                </span>

                {state.currentQuestion.questionEffect === 'bonus' && (
                  <span className="font-mono font-black px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/60 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>
                      BONUS QUESTION (+{state.currentQuestion.questionEffectPoints ?? state.settings.questionBonusPoints ?? 50} pts)
                    </span>
                  </span>
                )}

                {state.currentQuestion.questionEffect === 'minus' && (
                  <span className="font-mono font-black px-2.5 py-1 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/60 flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                    <span>
                      MINUS RISK (-{state.currentQuestion.questionEffectPoints ?? state.settings.questionMinusPoints ?? 50} pts if wrong)
                    </span>
                  </span>
                )}
              </div>
              <span className="text-base font-black font-mono text-cyan-400 tabular-nums">
                +{state.currentQuestion.points} pts
              </span>
            </div>

            <h2 className="text-xl md:text-2xl lg:text-3xl font-extrabold text-white leading-relaxed font-sans" dir="ltr">
              {state.currentQuestion.questionText}
            </h2>

            {state.currentQuestion.codeSnippet && (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 my-4 font-mono text-sm md:text-base text-cyan-200 overflow-x-auto shadow-inner" dir="ltr">
                <pre className="whitespace-pre leading-relaxed">{state.currentQuestion.codeSnippet}</pre>
              </div>
            )}

            {/* Revealed Canonical Answer for Open-Ended / Code / Output Questions */}
            {isEvaluating && (!state.currentQuestion.options || state.currentQuestion.options.length === 0) && (
              <div className="mt-4 p-4 rounded-2xl bg-emerald-950/70 border border-emerald-600/80 space-y-1" dir="ltr">
                <span className="text-[11px] font-mono uppercase text-emerald-300 font-bold block">
                  Verified Answer
                </span>
                <div className="text-lg font-mono font-black text-white">
                  {state.currentQuestion.correctAnswer}
                </div>
                {state.currentQuestion.answerExplanation && (
                  <p className="text-xs text-emerald-200/80 pt-1">
                    {state.currentQuestion.answerExplanation}
                  </p>
                )}
              </div>
            )}

            {/* Options display */}
            {state.currentQuestion.options && state.currentQuestion.options.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4" dir="ltr">
                {state.currentQuestion.options.map((opt, idx) => {
                  const letters = ['A', 'B', 'C', 'D'];
                  const isCorrect =
                    isEvaluating &&
                    !!state.currentQuestion &&
                    evaluateQuestionAnswer(state.currentQuestion, opt).isCorrect;

                  return (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-2xl border flex items-center gap-3 transition-all ${
                        isEvaluating
                          ? isCorrect
                            ? 'bg-emerald-950/90 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/50'
                            : 'bg-slate-950/60 border-slate-800 text-slate-500 opacity-60'
                          : 'bg-slate-950/80 border-slate-800 text-slate-200'
                      }`}
                    >
                      <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-mono font-bold text-sm ${
                        isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-cyan-400'
                      }`}>
                        {letters[idx]}
                      </span>
                      <span className="text-base font-medium">{opt}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 4 Teams Live Arena Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {rankings.map(rankEntry => {
            const team = state.teams[rankEntry.teamId];
            if (!team) return null;
            const answer = state.answers[team.id];
            const hasAnswered = !!answer;
            const isProtected = team.members.some(m => m.isLocked);
            const isDoubleArmed =
              state.activeDoublePointsByTeam?.[team.id]?.roundNumber === state.currentRoundNumber;
            const medals = ['🥇', '🥈', '🥉', '4th'];

            return (
              <div
                key={team.id}
                className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex flex-col justify-between"
                style={{ borderTop: `4px solid ${team.color}` }}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                      <span>{medals[rankEntry.rank - 1] || `#${rankEntry.rank}`}</span>
                      <span>{isAr ? `المركز ${rankEntry.rank}` : `Rank #${rankEntry.rank}`}</span>
                    </span>

                    <div className="flex items-center gap-1.5">
                      {isDoubleArmed && (
                        <span className="flex items-center gap-0.5 text-[10px] font-black text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-600">
                          <ChevronsUp className="w-3 h-3 text-emerald-400" />
                          <span>2X</span>
                        </span>
                      )}
                      {team.streak >= 3 && (
                        <span className="flex items-center gap-1 text-xs font-black text-amber-400 bg-amber-950 px-2 py-0.5 rounded-full border border-amber-800">
                          <Flame className="w-3.5 h-3.5 fill-amber-400" />
                          <span>Streak x{team.streak}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <h4 className="font-black text-lg text-white">{team.name}</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    <span className="text-slate-500">{isAr ? 'القائد:' : 'Leader:'}</span>{' '}
                    <span className="font-bold text-slate-200">{team.leaderName}</span>
                  </p>
                </div>

                <div className="my-4 py-3 border-y border-slate-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                      {isAr ? 'النقاط' : 'SCORE'}
                    </span>
                    <div className="text-3xl font-black font-mono text-cyan-400">
                      {team.score}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                      {isAr ? 'الأعضاء' : 'ROSTER'}
                    </span>
                    <div className="text-sm font-bold text-slate-300 flex items-center gap-1 justify-end">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <span>{team.members.length}</span>
                    </div>
                  </div>
                </div>

                {/* Submissions & Lock */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">{isAr ? 'حالة الإرسال:' : 'Submission:'}</span>
                    {hasAnswered ? (
                      isEvaluating ? (
                        answer.isCorrect ? (
                          <span className="font-bold text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>+{answer.pointsAwarded} pts</span>
                          </span>
                        ) : (
                          <span className="font-bold text-rose-400 flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>{isAr ? 'إجابة خاطئة' : 'Incorrect'}</span>
                          </span>
                        )
                      ) : (
                        <span className="font-bold text-cyan-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isAr ? 'تم الإرسال' : 'Submitted'}</span>
                        </span>
                      )
                    ) : (
                      <span className="text-slate-500 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                        <span>{isAr ? 'في الانتظار...' : 'Thinking...'}</span>
                      </span>
                    )}
                  </div>

                  {team.activeSession && (
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="truncate">
                        Device: {team.activeSession.operatorName || team.activeSession.userEmail}
                      </span>
                    </div>
                  )}

                  {isProtected && (
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 bg-blue-950/70 border border-blue-800/80 px-2 py-0.5 rounded-md">
                      <Shield className="w-3 h-3 text-blue-400" />
                      <span>{isAr ? 'يوجد لاعب محمي' : 'Player Locked'}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* PRIMARY ACTION BAR FOR TEACHER: Evaluate + Continue Button */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-0.5 text-center sm:text-right">
            <h4 className="font-black text-sm text-white">
              {isAr ? 'إدارة تقدم الجولات (Automatic Round Scheduler)' : 'Automatic Round Progression'}
            </h4>
            <p className="text-xs text-slate-400">
              {isAr
                ? 'الجولة التالية تُختار وتُطلق تلقائياً وفق جدول المسابقة المعتمد بضغطة زر واحدة.'
                : 'Next round is scheduled automatically according to competition rules with one click.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-center sm:justify-end">
            {(state.roundPhase === 'card_window' || state.roundPhase === 'question_active') && (
              <button
                type="button"
                onClick={evaluateRound}
                className="px-5 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-lg flex items-center gap-2 transition-all"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {state.roundPhase === 'card_window'
                    ? isAr
                      ? 'بدء الإجابة الآن'
                      : 'Start Answering Now'
                    : isAr
                    ? 'تقييم وكشف الإجابات'
                    : 'Evaluate & Reveal'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={continueNextRound}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-black text-sm shadow-xl shadow-cyan-500/20 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>
                {hasMorePrivateTurns
                  ? isAr
                    ? `اللاعب التالي (${activePrivateTurnIndex + 2} من ${privateTeamOrder.length})`
                    : `Next Participant (${activePrivateTurnIndex + 2}/${privateTeamOrder.length})`
                  : isAr
                  ? 'الجولة التالية (Continue)'
                  : 'Continue to Next Round'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Public Player Protection Status Board */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-300 font-bold">
            <Shield className="w-4 h-4 text-blue-400" />
            <span>{isAr ? 'حالة حماية اللاعبين المعلنة:' : 'Public Player Protection Status:'}</span>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {Object.values(state.teams).flatMap(t =>
              t.members.filter(m => m.isLocked).map(m => (
                <span
                  key={m.studentId}
                  className="px-2.5 py-1 rounded-md bg-blue-950 border border-blue-700 text-blue-300 font-medium flex items-center gap-1.5"
                >
                  <Shield className="w-3 h-3 text-blue-400" />
                  <span>{m.name}</span>
                  <span className="text-[10px] text-blue-400 font-bold">({t.name})</span>
                </span>
              ))
            )}
            {Object.values(state.teams).every(t => !t.members.some(m => m.isLocked)) && (
              <span className="text-slate-500 italic">
                {isAr ? 'لا يوجد لاعبون تحت الحماية حالياً' : 'No players currently shielded'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Admin Side Drawer */}
      {showAdminMenu && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex justify-end">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-md h-full p-6 flex flex-col justify-between overflow-y-auto shadow-2xl">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-black text-base text-white">
                    {isAr ? 'لوحة المدرس الإدارية' : 'Teacher Controls'}
                  </h3>
                </div>
                <button
                  onClick={() => setShowAdminMenu(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Match Quick Actions */}
              <div className="space-y-2">
                <button
                  onClick={togglePause}
                  className={`w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                    state.status === 'paused'
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  {state.status === 'paused' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  <span>{state.status === 'paused' ? (isAr ? 'استئناف المسابقة' : 'Resume Competition') : (isAr ? 'إيقاف مؤقت' : 'Pause Match')}</span>
                </button>

                <button
                  onClick={saveGame}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4 text-cyan-400" />
                  <span>{isAr ? 'حفظ المباراة (Save Game)' : 'Save Game'}</span>
                </button>

                <button
                  onClick={() => setShowQrModal(true)}
                  className="w-full py-2.5 rounded-xl bg-indigo-950 hover:bg-indigo-900 border border-indigo-700 text-indigo-300 font-bold text-xs flex items-center justify-center gap-2"
                >
                  <QrCode className="w-4 h-4 text-indigo-400" />
                  <span>{isAr ? 'عرض QR Code للهواتف' : 'Show Phone QR Code'}</span>
                </button>

                <button
                  onClick={openBankManager}
                  className="w-full py-2.5 rounded-xl bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 font-bold text-xs flex items-center justify-center gap-2"
                >
                  <Database className="w-4 h-4 text-cyan-400" />
                  <span>{isAr ? 'إدارة ومراجعة بنك الأسئلة' : 'Question Bank & AI Review'}</span>
                </button>

                {state.status !== 'completed' && (
                  <button
                    onClick={async () => {
                      setShowAdminMenu(false);
                      await endGame();
                    }}
                    className="w-full py-2.5 rounded-xl bg-amber-950 hover:bg-amber-900 border border-amber-700 text-amber-300 font-bold text-xs flex items-center justify-center gap-2"
                  >
                    <Flag className="w-4 h-4 text-amber-400" />
                    <span>{isAr ? 'إنهاء المسابقة وبدء الحفل الختامي' : 'End Match & Start Final Ceremony'}</span>
                  </button>
                )}
              </div>

              {/* Teacher Full Secret Card Inventory View */}
              <div className="space-y-3 pt-4 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-purple-400" />
                  <h4 className="font-black text-xs text-white">
                    {isAr ? 'مخزون كروت جميع الفرق (صلاحيات المدرس)' : 'All Teams Secret Card Inventories'}
                  </h4>
                </div>

                <div className="space-y-2.5">
                  {Object.values(state.teams).map(t => (
                    <div key={t.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2">
                      <div className="flex items-center justify-between font-bold">
                        <span className="text-white">{t.name}</span>
                        <span className="text-purple-400 font-mono">{t.secretCards.length} Cards</span>
                      </div>
                      {t.secretCards.length > 0 ? (
                        <div className="space-y-1.5">
                          {t.secretCards.map(c => (
                            <GameCard key={c.id} card={c} variant="mini" visualState="normal" />
                          ))}
                        </div>
                      ) : (
                        <span className="italic text-slate-600 text-[11px] block">No cards held</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Audit Log Peek */}
              <div className="space-y-2 pt-4 border-t border-slate-800">
                <h4 className="font-black text-xs text-white flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-slate-400" />
                  <span>{isAr ? 'سجل العمليات الأخير' : 'Recent Audit Log'}</span>
                </h4>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {state.auditLogs.slice(0, 5).map(log => (
                    <div key={log.id} className="p-2 rounded bg-slate-950 text-[11px] text-slate-300">
                      {isAr ? log.messageAr : log.messageEn}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Exit to Start Screen */}
            <div className="pt-4 border-t border-slate-800">
              <button
                onClick={quitToStartMenu}
                className="w-full py-2.5 rounded-xl bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 font-bold text-xs flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>{isAr ? 'العودة لشاشة البداية (Start Screen)' : 'Return to Start Screen'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl">
            <h3 className="font-black text-base text-white">
              {isAr ? 'رمز QR Code للمباراة الحالية' : 'Match Session QR Code'}
            </h3>
            {qrDataUrl && (
              <div className="bg-white p-3 rounded-2xl inline-block shadow-inner">
                <img src={qrDataUrl} alt="QR Code" className="w-48 h-48 mx-auto" />
              </div>
            )}
            <p className="text-xs text-slate-400 font-mono">
              {window.location.origin}/play?gameId={state.gameId}
            </p>
            <button
              onClick={() => setShowQrModal(false)}
              className="w-full py-2.5 rounded-xl bg-slate-800 text-xs font-bold text-slate-300"
            >
              {isAr ? 'إغلاق' : 'Close'}
            </button>
          </div>
        </div>
      )}

      {/* Question Bank & AI Review Modal */}
      {showBankModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 max-w-5xl w-full max-h-[90vh] flex flex-col space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-cyan-400" />
                <h3 className="font-black text-base text-white">
                  {isAr ? 'بنك الأسئلة ومراجعة الذكاء الاصطناعي' : 'Question Bank & AI Review Workspace'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowBankModal(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {bankQuestions.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                No questions currently in active bank.
              </div>
            ) : (
              <AIReviewWorkspace
                questions={bankQuestions}
                onUpdateQuestion={handleUpdateBankQuestion}
                onReplaceQuestion={handleReplaceBankQuestion}
                onDeleteQuestion={handleDeleteBankQuestion}
                maxHeightClass="max-h-[65vh]"
              />
            )}
          </div>
        </div>
      )}

      {/* Team Rivalry Dramatic Spotlight Overlay (Visual Only) */}
      {state.activeRivalry && !state.activeRivalry.dismissed && state.status !== 'completed' && (
        <TeamRivalryOverlay
          rivalry={state.activeRivalry}
          teams={state.teams}
          onDismiss={dismissRivalry}
        />
      )}

      {/* Official Final Ceremony & Persistent Match Summary */}
      <FinalCeremonyModal
        state={state}
        isOpen={shouldShowCeremonyModal}
        isReplay={isReplayCeremony}
        onSkipCeremony={skipCeremony}
        onCompleteCeremony={async () => {
          setIsReplayCeremony(false);
          await completeCeremony();
        }}
        onReplay={() => {
          setCeremonyClosedForGameId(null);
          setIsReplayCeremony(true);
        }}
        onSaveGame={saveGame}
        onQuitToStart={quitToStartMenu}
        onClose={() => {
          setIsReplayCeremony(false);
          setCeremonyClosedForGameId(state.gameId);
        }}
      />
    </div>
  );
};
