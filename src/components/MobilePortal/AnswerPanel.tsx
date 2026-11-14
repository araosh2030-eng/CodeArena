import React from 'react';
import { GameState, Team } from '../../types/game';
import { Send, Clock, Sparkles, Eye, Users, Zap, TrendingDown, ChevronsUp } from 'lucide-react';

interface AnswerPanelProps {
  state: GameState;
  team: Team;
  selectedOption: string;
  setSelectedOption: (val: string) => void;
  textAnswer: string;
  setTextAnswer: (val: string) => void;
  isSubmitting: boolean;
  onSubmit: () => Promise<void>;
}

/**
 * Center Answer Input Panel for Mobile Landscape Gaming HUD.
 * Intentionally does NOT repeat full question text or code snippet (shown on Teacher display).
 * Displays compact round metadata + ONLY the interactive answer controls.
 */
export const AnswerPanel: React.FC<AnswerPanelProps> = ({
  state,
  team,
  selectedOption,
  setSelectedOption,
  textAnswer,
  setTextAnswer,
  isSubmitting,
  onSubmit,
}) => {
  const isCardWindow = state.roundPhase === 'card_window';
  const isQuestionActive = state.roundPhase === 'question_active' && state.status !== 'paused';
  const question = isCardWindow ? undefined : state.currentQuestion;
  const isPrivateRound = state.currentRoundType === 'private_round';
  const privateSelected = isPrivateRound
    ? state.privateRoundGroup.selectedPlayerPerTeam[team.id]
    : null;
  const privateTeamOrder =
    state.privateRoundGroup?.teamOrder && state.privateRoundGroup.teamOrder.length > 0
      ? state.privateRoundGroup.teamOrder
      : Object.keys(state.teams);
  const activePrivateTurnIdx = state.privateRoundGroup?.activeTurnIndex ?? 0;
  const activePrivateTeamId = isPrivateRound ? privateTeamOrder[activePrivateTurnIdx] : undefined;
  const activePrivateTeam = activePrivateTeamId ? state.teams[activePrivateTeamId] : undefined;
  const activePrivateStudent = activePrivateTeamId
    ? state.privateRoundGroup?.selectedPlayerPerTeam?.[activePrivateTeamId]
    : undefined;
  const isMyPrivateTurn = !isPrivateRound || activePrivateTeamId === team.id;

  const isMcq =
    question?.type === 'multiple_choice' ||
    (question?.options && question.options.length > 2);
  const isTrueFalse = question?.type === 'true_false';

  return (
    <div className="flex flex-col justify-between h-full space-y-3">
      {/* Compact Metadata Strip (NO full question text!) */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/80 border border-slate-800 rounded-2xl px-3.5 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono font-black px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-300 border border-cyan-800 uppercase">
            {isCardWindow ? 'CARD WINDOW' : question ? (question.type || 'multiple_choice').replace(/_/g, ' ') : 'STANDBY'}
          </span>
          {!isCardWindow && question && (
            <span className="text-xs font-mono font-bold text-amber-300 tabular-nums">
              +{question.points} pts
            </span>
          )}
          {state.activeDoublePointsByTeam?.[team.id]?.roundNumber === state.currentRoundNumber && (
            <span className="text-[11px] font-mono font-black px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-400/60 flex items-center gap-1">
              <ChevronsUp className="w-3 h-3 text-emerald-400" />
              <span>DOUBLE POINTS 2X ACTIVE</span>
            </span>
          )}
          {!isCardWindow && question?.questionEffect === 'bonus' && (
            <span className="text-[11px] font-mono font-black px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/60 flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400" />
              <span>
                Bonus +{question.questionEffectPoints ?? state.settings.questionBonusPoints ?? 50} pts
              </span>
            </span>
          )}
          {!isCardWindow && question?.questionEffect === 'minus' && (
            <span className="text-[11px] font-mono font-black px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/60 flex items-center gap-1">
              <TrendingDown className="w-3 h-3 text-rose-400" />
              <span>
                Minus -{question.questionEffectPoints ?? state.settings.questionMinusPoints ?? 50} pts if wrong
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {team.wasInspectedBy && (
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-sky-950 text-sky-300 border border-sky-700 flex items-center gap-1">
              <Eye className="w-3 h-3 text-sky-400" />
              <span>Inventory Inspected</span>
            </span>
          )}
          <span className="text-[11px] font-mono text-slate-400">
            Look at main screen for question prompt
          </span>
        </div>
      </div>

      {/* Private Round Handover Banner */}
      {isPrivateRound && privateSelected && (
        <div className="px-3.5 py-2 rounded-2xl bg-emerald-950/70 border border-emerald-600/70 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-emerald-200">
            <Users className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Solo Private Round ({state.privateRoundGroup.roundIndexInBatch}/5) — Selected:{' '}
              <strong className="text-white">{privateSelected.name}</strong>
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold text-emerald-300 uppercase">
            {isQuestionActive && isMyPrivateTurn ? 'Your Turn Now' : 'Solo Answer'}
          </span>
        </div>
      )}

      {/* Answer Input Area */}
      {!isQuestionActive ? (
        <div className="flex-1 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-col items-center justify-center p-6 text-center space-y-2">
          {state.status === 'paused' ? (
            <>
              <Clock className="w-8 h-8 text-amber-400" />
              <p className="text-sm font-black text-amber-300">Match Paused by Teacher</p>
              <p className="text-xs text-slate-400">Waiting for competition to resume...</p>
            </>
          ) : isCardWindow ? (
            <>
              <Sparkles className="w-8 h-8 text-amber-400 animate-pulse" />
              <p className="text-sm font-black text-white">Strategic Card Window Active</p>
              <p className="text-xs text-slate-400">
                Play eligible cards from your Secret Inventory sidebar before the question reveals.
              </p>
            </>
          ) : (
            <>
              <Clock className="w-8 h-8 text-cyan-400" />
              <p className="text-sm font-black text-white">Waiting for Active Question</p>
              <p className="text-xs text-slate-400">
                Answer controls unlock automatically when the round starts.
              </p>
            </>
          )}
        </div>
      ) : !isMyPrivateTurn ? (
        <div className="flex-1 rounded-2xl bg-slate-950/75 border border-emerald-700/50 flex flex-col items-center justify-center p-6 text-center space-y-2.5">
          <Users className="w-8 h-8 text-emerald-400 animate-pulse" />
          <div className="space-y-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400">
              Private Round Turn {activePrivateTurnIdx + 1} of {privateTeamOrder.length}
            </span>
            <p className="text-base font-black text-white">
              Waiting for {activePrivateTeam?.name || activePrivateTeamId} (
              {activePrivateStudent?.name || 'Participant'})
            </p>
          </div>
          <p className="text-xs text-slate-400 max-w-sm">
            Private Round participants answer one at a time. Your answer controls will activate automatically when it is your team&apos;s turn.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-between space-y-3">
          {/* Multiple Choice Options ONLY */}
          {isMcq && question?.options && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 content-center" dir="ltr">
              {question.options.map((opt, idx) => {
                const isSelected = selectedOption === opt;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedOption(opt)}
                    className={`min-h-[52px] px-3.5 py-2.5 rounded-2xl border-2 text-left flex items-center gap-3 transition-all ${
                      isSelected
                        ? 'bg-cyan-600/25 border-cyan-400 text-white ring-2 ring-cyan-400/30 shadow-lg'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-600 text-slate-200'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-xl flex items-center justify-center font-mono font-black text-xs shrink-0 ${
                        isSelected ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-cyan-400'
                      }`}
                    >
                      {['A', 'B', 'C', 'D'][idx] || idx + 1}
                    </span>
                    <span className="text-sm font-semibold leading-snug break-words">{opt}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* True / False Buttons ONLY */}
          {!isMcq && isTrueFalse && (
            <div className="grid grid-cols-2 gap-3 flex-1 items-center" dir="ltr">
              {['True', 'False'].map(val => {
                const isSelected = selectedOption === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setSelectedOption(val)}
                    className={`min-h-[76px] rounded-2xl border-2 font-black text-lg transition-all ${
                      isSelected
                        ? val === 'True'
                          ? 'bg-emerald-600 text-white border-emerald-400 ring-2 ring-emerald-400/40 shadow-lg'
                          : 'bg-rose-600 text-white border-rose-400 ring-2 ring-rose-400/40 shadow-lg'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-600 text-slate-200'
                    }`}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
          )}

          {/* Code / Open Text Editor ONLY */}
          {!isMcq && !isTrueFalse && (
            <div className="flex-1 flex flex-col space-y-1.5" dir="ltr">
              <label htmlFor="code-answer-input" className="text-[11px] font-mono font-bold text-slate-400">
                Enter Exact Code / Answer:
              </label>
              <textarea
                id="code-answer-input"
                rows={4}
                value={textAnswer}
                onChange={e => setTextAnswer(e.target.value)}
                placeholder="Type your exact answer or missing code snippet..."
                className="flex-1 w-full bg-slate-950 border-2 border-slate-800 focus:border-cyan-500 rounded-2xl p-3 font-mono text-sm text-cyan-200 focus:outline-none resize-none"
              />
            </div>
          )}

          {/* Submit Action */}
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting || (!selectedOption && !textAnswer.trim())}
            className="w-full min-h-[46px] py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 text-white font-black rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg transition-all"
          >
            <Send className="w-4 h-4" />
            <span>{isSubmitting ? 'Submitting Answer...' : 'Submit Answer'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
