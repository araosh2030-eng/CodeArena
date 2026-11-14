import React from 'react';
import { AnswerSubmission, GameState, Team } from '../../types/game';
import { shouldRevealAnswerResult } from '../../game/rules';
import { CheckCircle2, XCircle, Clock, Trophy, Zap, TrendingDown, ChevronsUp } from 'lucide-react';

interface AnswerFeedbackProps {
  state: GameState;
  team: Team;
  submission: AnswerSubmission;
}

/**
 * Displays server-confirmed answer state:
 * - While other teams are still answering (roundPhase !== 'evaluating'/'round_ended'),
 *   shows ONLY "Answer Submitted" without leaking correctness.
 * - In sequential Private Rounds, a completed turn stays revealed immediately even while later teams take their turn.
 */
export const AnswerFeedback: React.FC<AnswerFeedbackProps> = ({
  state,
  team,
  submission,
}) => {
  const isPrivateRound = state.currentRoundType === 'private_round';
  const privateTurnRevealed =
    isPrivateRound && !!state.privateRoundGroup?.turnSubmissions?.[team.id];
  const revealed = shouldRevealAnswerResult(state.roundPhase) || privateTurnRevealed;

  if (!revealed) {
    return (
      <div className="flex-1 rounded-2xl bg-slate-950/80 border border-cyan-500/40 p-6 flex flex-col items-center justify-center text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-cyan-950 border border-cyan-500/50 flex items-center justify-center">
          <Clock className="w-6 h-6 text-cyan-400 animate-pulse" />
        </div>
        <div className="space-y-1">
          <h4 className="text-lg font-black text-white">Answer Submitted</h4>
          <p className="text-xs font-mono text-cyan-300 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800 inline-block">
            Locked Answer: {submission.answer || '(No response)'}
          </p>
        </div>
        <p className="text-xs text-slate-400 max-w-sm">
          Waiting for other teams and round evaluation. Results will be revealed once answering closes.
        </p>
      </div>
    );
  }

  const privateTeamOrder =
    state.privateRoundGroup?.teamOrder && state.privateRoundGroup.teamOrder.length > 0
      ? state.privateRoundGroup.teamOrder
      : Object.keys(state.teams);
  const activePrivateTurnIdx = state.privateRoundGroup?.activeTurnIndex ?? 0;
  const activeTurnTeamId = isPrivateRound ? privateTeamOrder[activePrivateTurnIdx] : undefined;
  const waitingOnOtherPrivateTurn =
    isPrivateRound &&
    state.roundPhase === 'question_active' &&
    activeTurnTeamId &&
    activeTurnTeamId !== team.id;

  if (submission.isCorrect) {
    return (
      <div className="flex-1 rounded-2xl bg-emerald-950/40 border-2 border-emerald-500/70 p-6 flex flex-col items-center justify-center text-center space-y-3 shadow-xl">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-400 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <div className="space-y-1">
          <span className="text-[10px] font-mono font-bold text-emerald-300 uppercase tracking-widest">
            Server Confirmed
          </span>
          <h4 className="text-2xl font-black text-emerald-300">Correct Answer!</h4>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <span className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white font-mono font-black text-sm tabular-nums shadow">
            +{submission.pointsAwarded} pts
          </span>
          {submission.doublePointsApplied && (
            <span className="px-3 py-1.5 rounded-xl bg-emerald-950 border border-emerald-500/70 text-emerald-300 font-mono font-bold text-xs flex items-center gap-1">
              <ChevronsUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Double Points x2 (+{submission.doubledBaseBonus ?? submission.basePoints ?? 0} Base Bonus)
              </span>
            </span>
          )}
          {submission.effectApplied === 'bonus' && (submission.effectDelta ?? 0) > 0 && (
            <span className="px-3 py-1.5 rounded-xl bg-amber-950 border border-amber-500/70 text-amber-300 font-mono font-bold text-xs flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Includes +{submission.effectDelta} Bonus Effect</span>
            </span>
          )}
          {submission.speedRank && (
            <span className="px-3 py-1.5 rounded-xl bg-amber-950 border border-amber-600 text-amber-300 font-mono font-bold text-xs">
              Speed Rank #{submission.speedRank}
            </span>
          )}
          <span className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-cyan-300 font-mono font-bold text-xs flex items-center gap-1 tabular-nums">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span>Total: {team.score} pts</span>
          </span>
        </div>

        {waitingOnOtherPrivateTurn && activeTurnTeamId && (
          <p className="text-xs text-slate-400 pt-1">
            Private Turn {activePrivateTurnIdx + 1}/{privateTeamOrder.length}: Waiting for{' '}
            {state.teams[activeTurnTeamId]?.name || activeTurnTeamId}...
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-2xl bg-rose-950/35 border-2 border-rose-500/70 p-5 flex flex-col items-center justify-center text-center space-y-3 shadow-xl">
      <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-400 flex items-center justify-center">
        <XCircle className="w-7 h-7 text-rose-400" />
      </div>
      <div className="space-y-0.5">
        <span className="text-[10px] font-mono font-bold text-rose-300 uppercase tracking-widest">
          Server Confirmed
        </span>
        <h4 className="text-xl font-black text-rose-300">Incorrect Answer</h4>
      </div>

      {submission.effectApplied === 'minus' && (submission.effectDelta ?? 0) < 0 && (
        <span className="px-3 py-1 rounded-xl bg-rose-950 border border-rose-600 text-rose-200 font-mono font-bold text-xs flex items-center gap-1.5">
          <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
          <span>Minus Question Penalty: {submission.effectDelta} pts</span>
        </span>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-md text-left" dir="ltr">
        <div className="p-2.5 rounded-xl bg-slate-950 border border-rose-800/60">
          <span className="block text-[10px] font-mono text-rose-400 uppercase">Your Answer</span>
          <span className="block text-xs font-mono font-bold text-slate-200 mt-0.5 break-words">
            {submission.answer || '(No answer submitted)'}
          </span>
        </div>
        <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-700/70">
          <span className="block text-[10px] font-mono text-emerald-400 uppercase">Correct Answer</span>
          <span className="block text-xs font-mono font-bold text-emerald-300 mt-0.5 break-words">
            {submission.correctAnswerSnapshot || state.currentQuestion?.correctAnswer || '—'}
          </span>
        </div>
      </div>

      {waitingOnOtherPrivateTurn && activeTurnTeamId && (
        <p className="text-xs text-slate-400 pt-1">
          Private Turn {activePrivateTurnIdx + 1}/{privateTeamOrder.length}: Waiting for{' '}
          {state.teams[activeTurnTeamId]?.name || activeTurnTeamId}...
        </p>
      )}
    </div>
  );
};
