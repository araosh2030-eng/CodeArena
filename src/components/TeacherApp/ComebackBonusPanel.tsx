import React from 'react';
import { ComebackBonusEvent } from '../../types/game';
import { Zap, Play, SkipForward, CheckCircle2, XCircle, ArrowRight, Code2 } from 'lucide-react';

interface ComebackBonusPanelProps {
  activeEvent: ComebackBonusEvent;
  onStartQuestion: () => Promise<void>;
  onSkip: () => Promise<void>;
  onContinueNextRound: () => Promise<{ success: boolean; error?: string }>;
}

export const ComebackBonusPanel: React.FC<ComebackBonusPanelProps> = ({
  activeEvent,
  onStartQuestion,
  onSkip,
  onContinueNextRound,
}) => {
  const q = activeEvent.assignedQuestion;
  const isCorrect = activeEvent.answerResult === 'correct';

  return (
    <section
      data-testid="comeback-bonus-panel"
      className="bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-900 border-2 border-amber-500/70 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-400 flex items-center justify-center">
            <Zap className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <span className="text-[10px] font-mono font-black uppercase tracking-widest text-amber-300 block">
              Between-Round Special Event
            </span>
            <h3 className="text-lg font-black text-white">
              COMEBACK BONUS — {activeEvent.eligibleTeamName}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-slate-300">
            Trailing by {activeEvent.scoreDifferenceAtActivation} pts
          </span>
          <span className="px-3 py-1 rounded-xl bg-amber-500 text-slate-950 text-xs font-mono font-black">
            Reward: +{activeEvent.rewardValue} PTS
          </span>
        </div>
      </div>

      {activeEvent.status === 'announced' && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-950/75 border border-slate-800 rounded-2xl p-4">
          <div className="space-y-1 text-center sm:text-left">
            <p className="text-sm font-bold text-white">
              {activeEvent.eligibleTeamName} qualifies for their one-time Comeback Bonus chance!
            </p>
            <p className="text-xs text-slate-400">
              Correct answer awards +{activeEvent.rewardValue} pts (fixed, not doubled). Wrong answer awards 0 pts with zero penalty.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onSkip}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1.5"
            >
              <SkipForward className="w-3.5 h-3.5" />
              <span>Skip</span>
            </button>
            <button
              type="button"
              onClick={onStartQuestion}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-lg"
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" />
              <span>Launch Comeback Question</span>
            </button>
          </div>
        </div>
      )}

      {activeEvent.status === 'question_active' && q && (
        <div className="space-y-4 bg-slate-950/80 border border-slate-800 rounded-2xl p-5" dir="ltr">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-amber-950 border border-amber-700 text-amber-300 font-mono font-bold uppercase">
                {(q.type || 'multiple_choice').replace(/_/g, ' ')}
              </span>
              {q.programmingLanguage && (
                <span className="px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800 text-indigo-300 font-mono font-bold flex items-center gap-1">
                  <Code2 className="w-3 h-3" />
                  <span>{q.programmingLanguage}</span>
                </span>
              )}
            </div>
            <span className="text-xs font-mono text-amber-300 font-bold">
              Waiting for {activeEvent.eligibleTeamName} on mobile...
            </span>
          </div>

          <h4 className="text-xl font-extrabold text-white leading-relaxed">{q.questionText}</h4>

          {q.codeSnippet && (
            <pre className="bg-slate-900 border border-slate-800 rounded-xl p-3 font-mono text-sm text-cyan-200 overflow-x-auto">
              {q.codeSnippet}
            </pre>
          )}

          {q.options && q.options.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {q.options.map((opt, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2.5 text-sm text-slate-200"
                >
                  <span className="w-7 h-7 rounded-lg bg-slate-800 text-amber-300 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                    {['A', 'B', 'C', 'D'][idx] || idx + 1}
                  </span>
                  <span>{opt}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeEvent.status === 'resolved' && (
        <div
          className={`flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl p-4 border ${
            isCorrect
              ? 'bg-emerald-950/50 border-emerald-500/70'
              : 'bg-slate-950 border-slate-700'
          }`}
        >
          <div className="flex items-center gap-3">
            {isCorrect ? (
              <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-7 h-7 text-rose-400 shrink-0" />
            )}
            <div>
              <h4
                className={`text-base font-black ${
                  isCorrect ? 'text-emerald-300' : 'text-slate-200'
                }`}
              >
                {isCorrect
                  ? `${activeEvent.eligibleTeamName} Solved It! +${activeEvent.rewardValue} PTS`
                  : `${activeEvent.eligibleTeamName} Missed — 0 Points (No Penalty)`}
              </h4>
              {activeEvent.answerSubmitted && (
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Submitted: {activeEvent.answerSubmitted}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onContinueNextRound()}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-black text-xs flex items-center gap-1.5 shadow-lg shrink-0"
          >
            <span>Continue to Next Round</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </section>
  );
};
