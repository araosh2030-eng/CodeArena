import React, { useEffect, useRef, useState } from 'react';
import { GameState, TeamRankingEntry } from '../../types/game';
import { buildFinalMatchSummary } from '../../game/rules';
import confetti from 'canvas-confetti';
import {
  Trophy,
  Crown,
  SkipForward,
  RotateCcw,
  Save,
  LogOut,
  CheckCircle2,
  ArrowRight,
  BarChart3,
  Layers
} from 'lucide-react';

type CeremonyStage = 'countdown' | 'stats' | 'podium' | 'champion' | 'summary';

interface FinalCeremonyModalProps {
  state: GameState;
  isOpen: boolean;
  isReplay?: boolean;
  onSkipCeremony: () => Promise<void>;
  onCompleteCeremony: () => Promise<void>;
  onReplay: () => void;
  onSaveGame: () => Promise<void>;
  onQuitToStart: () => Promise<void>;
  onClose?: () => void;
}

export const FinalCeremonyModal: React.FC<FinalCeremonyModalProps> = ({
  state,
  isOpen,
  isReplay = false,
  onSkipCeremony,
  onCompleteCeremony,
  onReplay,
  onSaveGame,
  onQuitToStart,
  onClose,
}) => {
  const summary = state.ceremony?.summary || buildFinalMatchSummary(state);
  const startInSummary = !!state.ceremony?.ceremonyCompleted && !isReplay;

  const [stage, setStage] = useState<CeremonyStage>(startInSummary ? 'summary' : 'countdown');
  const [countdownVal, setCountdownVal] = useState<number>(3);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);
  const confettiFiredRef = useRef<boolean>(false);
  const completionReportedRef = useRef<boolean>(false);

  // Sync starting stage cleanly when modal opens or replay triggers
  useEffect(() => {
    if (!isOpen) return;
    if (isReplay || !state.ceremony?.ceremonyCompleted) {
      confettiFiredRef.current = false;
      completionReportedRef.current = false;
      setStage('countdown');
      setCountdownVal(3);
    } else {
      setStage('summary');
    }
  }, [isOpen, isReplay, state.gameId]);

  // Countdown progression
  useEffect(() => {
    if (!isOpen || stage !== 'countdown') return;
    if (countdownVal <= 0) {
      setStage('stats');
      return;
    }
    const timer = setTimeout(() => setCountdownVal(v => v - 1), 850);
    return () => clearTimeout(timer);
  }, [isOpen, stage, countdownVal]);

  // Trigger confetti + persist ceremony completion once champion stage is reached
  useEffect(() => {
    if (!isOpen || stage !== 'champion') return;
    if (!confettiFiredRef.current) {
      confettiFiredRef.current = true;
      confetti({
        particleCount: 160,
        spread: 95,
        origin: { y: 0.55 },
      });
    }
    if (!completionReportedRef.current) {
      completionReportedRef.current = true;
      onCompleteCeremony().catch(() => {});
    }
  }, [isOpen, stage]);

  if (!isOpen) return null;

  const standings: TeamRankingEntry[] = summary.standings || [];
  const champions = standings.filter(r => summary.championTeamIds.includes(r.teamId));
  const isTiedForFirst = summary.isTieForFirst || champions.length > 1;
  const accuracyPercent =
    summary.totalQuestionsAnswered > 0
      ? Math.round((summary.correctAnswersCount / summary.totalQuestionsAnswered) * 100)
      : 0;
  const totalPointsScored = standings.reduce((sum, s) => sum + s.score, 0);

  const handleSkip = async () => {
    await onSkipCeremony();
    setStage('summary');
  };

  return (
    <div
      data-testid="final-ceremony-modal"
      className="fixed inset-0 z-[70] bg-slate-950/92 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="max-w-4xl w-full bg-slate-900 border-2 border-amber-500/50 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 my-auto">
        {/* Top Bar with Skip Ceremony during ceremony stages */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/60 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-amber-300 block">
                {stage === 'summary' ? 'Match Archive & Standings' : 'Official Final Ceremony'}
              </span>
              <h2 className="text-lg font-black text-white">{state.name}</h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {stage !== 'summary' && (
              <button
                type="button"
                onClick={handleSkip}
                data-testid="skip-ceremony-btn"
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5"
              >
                <SkipForward className="w-3.5 h-3.5" />
                <span>Skip Ceremony</span>
              </button>
            )}
            {stage === 'summary' && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* Stage 1: Final Countdown */}
        {stage === 'countdown' && (
          <div className="py-12 text-center space-y-6">
            <span className="text-xs font-mono font-bold uppercase tracking-[0.25em] text-cyan-400 block">
              All Rounds Complete — Locking Official Results
            </span>
            <div className="w-32 h-32 rounded-3xl bg-gradient-to-br from-amber-500/20 to-cyan-500/20 border-2 border-amber-400/70 mx-auto flex items-center justify-center text-6xl font-black font-mono text-white shadow-2xl">
              {Math.max(1, countdownVal)}
            </div>
            <button
              type="button"
              onClick={() => setStage('stats')}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-black text-xs inline-flex items-center gap-1.5"
            >
              <span>Reveal Match Statistics</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stage 2: Match Statistics */}
        {stage === 'stats' && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">
                Stage 2 • Verified Match Totals
              </span>
              <h3 className="text-2xl font-black text-white">Competition Statistics</h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'Rounds Completed', value: summary.totalRoundsCompleted },
                { label: 'Questions Answered', value: summary.totalQuestionsAnswered },
                { label: 'Correct Answers', value: summary.correctAnswersCount },
                { label: 'Accuracy Rate', value: `${accuracyPercent}%` },
                { label: 'Total Team Points', value: totalPointsScored },
              ].map(item => (
                <div
                  key={item.label}
                  className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-1"
                >
                  <span className="text-[11px] font-bold text-slate-400 block">{item.label}</span>
                  <span className="text-2xl font-black font-mono text-cyan-300 tabular-nums">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setStage('podium')}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-black text-sm flex items-center gap-2 shadow-xl"
              >
                <span>Reveal Podium Rankings</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Stage 3: Podium Rankings */}
        {stage === 'podium' && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <span className="text-xs font-mono uppercase tracking-widest text-amber-400">
                Stage 3 • Official Podium
              </span>
              <h3 className="text-2xl font-black text-white">Final Team Standings</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {standings.map(entry => (
                <div
                  key={entry.teamId}
                  className={`p-4 rounded-2xl border-2 space-y-2 ${
                    entry.rank === 1
                      ? 'bg-amber-950/35 border-amber-400 shadow-lg shadow-amber-500/20'
                      : 'bg-slate-950 border-slate-800'
                  }`}
                  style={{ borderTop: `4px solid ${entry.color}` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-lg bg-slate-900 border border-slate-700 font-mono font-black text-xs text-amber-300">
                      Rank #{entry.rank}
                    </span>
                    {entry.rank === 1 && <Crown className="w-4 h-4 text-amber-400" />}
                  </div>
                  <h4 className="font-black text-base text-white truncate">{entry.teamName}</h4>
                  <div className="text-2xl font-black font-mono text-cyan-300 tabular-nums">
                    {entry.score} <span className="text-xs text-slate-400">pts</span>
                  </div>
                  <span className="block text-[11px] font-mono text-slate-400">
                    {entry.diffFromLeader === 0
                      ? isTiedForFirst
                        ? 'Tied 1st Place'
                        : '1st Place'
                      : `${entry.diffFromLeader} pts from 1st`}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setStage('champion')}
                className="px-7 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-black text-sm flex items-center gap-2 shadow-xl"
              >
                <Crown className="w-4 h-4" />
                <span>Proceed to Champion Reveal</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Stage 4: Champion Reveal (Tie-Safe) */}
        {stage === 'champion' && (
          <div className="py-6 text-center space-y-6">
            <div className="w-20 h-20 rounded-3xl bg-amber-500/20 border-2 border-amber-400 mx-auto flex items-center justify-center shadow-2xl shadow-amber-500/25">
              <Crown className="w-10 h-10 text-amber-300" />
            </div>

            <div className="space-y-2">
              <span className="text-xs font-mono font-black uppercase tracking-[0.22em] text-amber-300 block">
                {isTiedForFirst
                  ? 'SHARED CHAMPIONSHIP — TIE FOR 1ST PLACE'
                  : 'OFFICIAL CODEARENA CHAMPION'}
              </span>
              <h3 className="text-3xl sm:text-4xl font-black text-white">
                {champions.map(c => c.teamName).join(' & ')}
              </h3>
              <p className="text-lg font-mono font-black text-cyan-300">
                Final Score: {champions[0]?.score ?? 0} Points
              </p>
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setStage('summary')}
                className="px-7 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-black text-sm flex items-center gap-2 shadow-xl"
              >
                <span>Open Final Summary</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Stage 5: Final Summary & Saved State Access */}
        {stage === 'summary' && (
          <div className="space-y-5">
            <div className="p-4 rounded-2xl bg-amber-950/35 border border-amber-500/50 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Crown className="w-7 h-7 text-amber-400 shrink-0" />
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-amber-300 block">
                    {isTiedForFirst ? 'Shared 1st Place Champions' : 'Tournament Champion'}
                  </span>
                  <h3 className="text-xl font-black text-white">
                    {champions.map(c => c.teamName).join(' & ')} ({champions[0]?.score ?? 0} pts)
                  </h3>
                </div>
              </div>
              <span className="px-3 py-1 rounded-xl bg-emerald-950 border border-emerald-700 text-emerald-300 text-xs font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Saved in Match History</span>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {[
                { label: 'Rounds Played', value: summary.totalRoundsCompleted, icon: Layers },
                { label: 'Answered', value: summary.totalQuestionsAnswered, icon: CheckCircle2 },
                { label: 'Correct', value: summary.correctAnswersCount, icon: CheckCircle2 },
                { label: 'Accuracy', value: `${accuracyPercent}%`, icon: BarChart3 },
                { label: 'Total Score', value: totalPointsScored, icon: Trophy },
              ].map(stat => (
                <div
                  key={stat.label}
                  className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-center"
                >
                  <span className="text-[10px] text-slate-400 block">{stat.label}</span>
                  <span className="text-lg font-black font-mono text-cyan-300 tabular-nums">
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              {standings.map(entry => (
                <div
                  key={entry.teamId}
                  className="px-4 py-2.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                  style={{ borderLeft: `4px solid ${entry.color}` }}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-black text-sm text-amber-300 w-7">
                      #{entry.rank}
                    </span>
                    <span className="font-bold text-sm text-white">{entry.teamName}</span>
                  </div>
                  <div className="text-right font-mono">
                    <span className="font-black text-sm text-cyan-300 tabular-nums">
                      {entry.score} pts
                    </span>
                    <span className="text-[11px] text-slate-500 ml-3">
                      {entry.diffFromLeader === 0 ? 'Lead' : entry.diffFromLeader}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onReplay}
                  className="px-4 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-amber-200 font-bold text-xs flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Replay Ceremony</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onSaveGame();
                    setSavedNotice(true);
                    setTimeout(() => setSavedNotice(false), 2000);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{savedNotice ? 'Saved!' : 'Save Match Copy'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={onQuitToStart}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-black text-xs flex items-center gap-1.5 shadow-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Return to Start Screen</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
