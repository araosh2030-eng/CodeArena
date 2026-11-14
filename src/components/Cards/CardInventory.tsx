import React, { useState } from 'react';
import { CardInstance, GameState, Team } from '../../types/game';
import { CARD_DEFINITIONS } from '../../game/defaultData';
import { formatCardTitle, isCardEligibleForRound } from '../../game/rules';
import { GameCard } from './GameCard';
import { CardBack } from './CardBack';
import { Shield, Sparkles, X, AlertCircle, Play } from 'lucide-react';

interface CardInventoryProps {
  team: Team;
  state: GameState;
  onClaimCard: () => Promise<void>;
  onSelectCardToUse: (card: CardInstance) => void;
  isClaiming?: boolean;
}

export const CardInventory: React.FC<CardInventoryProps> = ({
  team,
  state,
  onClaimCard,
  onSelectCardToUse,
  isClaiming = false,
}) => {
  const [inspectCard, setInspectCard] = useState<CardInstance | null>(null);

  const usedThisRound = state.cardsUsedThisRound[team.id] || [];
  const nonDefenseUsedCount =
    state.settings.defensiveCardLimitMode === 'free_defense'
      ? usedThisRound.filter(t => !CARD_DEFINITIONS[t]?.isDefensive).length
      : usedThisRound.length;
  const roundLimitReached = nonDefenseUsedCount >= 1;

  const getDisabledReason = (card: CardInstance): string | undefined => {
    const def = CARD_DEFINITIONS[card.cardType];
    if (!isCardEligibleForRound(card, state.currentRoundNumber)) {
      return `Earned Round ${card.earnedInRound ?? state.currentRoundNumber} — available Round ${card.availableFromRound}`;
    }
    if (def.isDefensive) {
      return 'Defense card: activates automatically during incoming Reaction Window';
    }
    if (card.cardType === 'double_points' && state.roundPhase !== 'card_window') {
      return 'Playable ONLY during Card Window before the question is revealed';
    }
    if (roundLimitReached) {
      return 'Round card limit reached (1 active card per round)';
    }
    return undefined;
  };

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-200">
            Secret Inventory
          </h3>
        </div>
        <span className="text-[11px] font-mono font-bold text-cyan-300 bg-cyan-950/80 border border-cyan-800 px-2 py-0.5 rounded-md">
          {team.secretCards.length}
        </span>
      </div>

      {/* Draw Unlocked Banner */}
      {team.pointsAccumulatedForCards > 0 && (
        <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/50 space-y-2">
          <div className="flex items-center gap-1.5 text-amber-300 text-xs font-bold">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{team.pointsAccumulatedForCards} Draw(s) Unlocked!</span>
          </div>
          <button
            type="button"
            disabled={isClaiming}
            onClick={onClaimCard}
            className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs transition-all shadow-md"
          >
            {isClaiming ? 'Drawing...' : 'Draw Mystery Card'}
          </button>
        </div>
      )}

      {/* Secret Cards List (Mini Cards) */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
        {team.secretCards.length > 0 ? (
          team.secretCards.map(card => {
            const def = CARD_DEFINITIONS[card.cardType];
            const eligibleThisRound = isCardEligibleForRound(card, state.currentRoundNumber);
            const disabledReason = getDisabledReason(card);
            // Allow clicking locked/defensive cards to inspect their details modal, while visually marking locked ones
            return (
              <div key={card.id} className="space-y-1">
                <GameCard
                  card={card}
                  variant="mini"
                  visualState={
                    !eligibleThisRound
                      ? 'normal'
                      : def.isDefensive
                      ? 'normal'
                      : roundLimitReached ||
                        (card.cardType === 'double_points' && state.roundPhase !== 'card_window')
                      ? 'disabled'
                      : 'normal'
                  }
                  disabledReason={disabledReason}
                  onClick={() => setInspectCard(card)}
                />
                {!eligibleThisRound && (
                  <div className="px-2 py-0.5 rounded-lg bg-amber-950/80 border border-amber-700/60 text-[10px] font-mono font-bold text-amber-300 text-center">
                    Locked until Round {card.availableFromRound}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-col items-center text-center space-y-2">
            <CardBack size="sm" />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              No secret cards yet. Unlock 1 draw per {state.settings.pointsPer200ForCard} pts.
            </p>
          </div>
        )}
      </div>

      {/* Card Details Modal */}
      {inspectCard && (
        <div className="fixed inset-0 z-[65] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-5 shadow-2xl flex flex-col sm:flex-row items-center gap-5">
            <div className="shrink-0">
              <GameCard
                card={inspectCard}
                variant="full"
                visualState={
                  !isCardEligibleForRound(inspectCard, state.currentRoundNumber)
                    ? 'disabled'
                    : 'selected'
                }
              />
            </div>

            <div className="flex-1 space-y-3 text-left w-full">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-widest">
                    Card Details
                  </span>
                  <h4 className="text-lg font-black text-white">
                    {formatCardTitle(inspectCard)}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectCard(null)}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {CARD_DEFINITIONS[inspectCard.cardType].descriptionEn}
              </p>

              {getDisabledReason(inspectCard) && (
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-amber-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                  <span>{getDisabledReason(inspectCard)}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setInspectCard(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300"
                >
                  Close
                </button>

                {!CARD_DEFINITIONS[inspectCard.cardType].isDefensive && (
                  <button
                    type="button"
                    disabled={
                      roundLimitReached ||
                      !isCardEligibleForRound(inspectCard, state.currentRoundNumber) ||
                      (inspectCard.cardType === 'double_points' && state.roundPhase !== 'card_window')
                    }
                    onClick={() => {
                      const chosen = inspectCard;
                      setInspectCard(null);
                      onSelectCardToUse(chosen);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 text-xs font-black text-white flex items-center justify-center gap-1.5 shadow-lg"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Use Card</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
