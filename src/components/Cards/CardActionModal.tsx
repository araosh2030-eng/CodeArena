import React, { useState, useEffect } from 'react';
import {
  ActiveReaction,
  CardInstance,
  CardType,
  GameState,
  GiftDraft,
  InspectionSnapshot,
  Team,
  TeamMember
} from '../../types/game';
import { CARD_DEFINITIONS } from '../../game/defaultData';
import { formatCardTitle, isCardEligibleForRound } from '../../game/rules';
import { GameCard } from './GameCard';
import {
  Shield,
  ShieldAlert,
  Lock,
  Crown,
  Users,
  X,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Eye,
  Gift,
  Zap,
  Clock,
  ArrowRight,
  ArrowLeftRight,
  ChevronsUp
} from 'lucide-react';

interface TeamSelectionCardProps {
  team: Team;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}

export const TeamSelectionCard: React.FC<TeamSelectionCardProps> = ({
  team,
  selected,
  disabled,
  disabledReason,
  onSelect,
}) => {
  const lockedCount = team.members.filter(m => m.isLocked).length;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
        disabled
          ? 'bg-slate-950/40 border-slate-800/60 opacity-45 cursor-not-allowed'
          : selected
          ? 'bg-cyan-950/60 border-cyan-400 ring-2 ring-cyan-400/40 shadow-lg'
          : 'bg-slate-950 border-slate-800 hover:border-slate-600'
      }`}
      style={{ borderTop: `3px solid ${team.color}` }}
    >
      <div className="flex items-center justify-between gap-2 w-full">
        <span className="font-black text-sm text-white truncate">{team.name}</span>
        <span className="font-mono text-xs font-bold text-cyan-400 tabular-nums">
          {team.score} pts
        </span>
      </div>
      <div className="text-[11px] text-slate-400 truncate">
        Leader: <span className="text-slate-200 font-semibold">{team.leaderName}</span>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          <span>{team.members.length} players</span>
        </span>
        {lockedCount > 0 && (
          <span className="text-blue-400 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            <span>{lockedCount}</span>
          </span>
        )}
      </div>
      {disabled && disabledReason && (
        <span className="text-[10px] text-rose-400 font-semibold">{disabledReason}</span>
      )}
    </button>
  );
};

interface PlayerSelectionCardProps {
  member: TeamMember;
  selected: boolean;
  onSelect: () => void;
}

export const PlayerSelectionCard: React.FC<PlayerSelectionCardProps> = ({
  member,
  selected,
  onSelect,
}) => {
  const isProtected = member.isLeader || member.isLocked;

  return (
    <button
      type="button"
      disabled={isProtected}
      onClick={onSelect}
      className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
        isProtected
          ? 'bg-slate-950/40 border-slate-800 opacity-50 cursor-not-allowed'
          : selected
          ? 'bg-cyan-950/70 border-cyan-400 ring-2 ring-cyan-400/40 text-white'
          : 'bg-slate-950 border-slate-800 hover:border-slate-600 text-slate-200'
      }`}
    >
      <div className="min-w-0">
        <span className="block font-bold text-xs truncate">{member.name}</span>
        {member.nickname && (
          <span className="block text-[10px] font-mono text-cyan-400">"{member.nickname}"</span>
        )}
      </div>
      {member.isLeader ? (
        <span className="px-2 py-0.5 rounded-md bg-amber-950 border border-amber-700 text-amber-300 text-[10px] font-bold flex items-center gap-1 shrink-0">
          <Crown className="w-3 h-3" />
          <span>Leader</span>
        </span>
      ) : member.isLocked ? (
        <span className="px-2 py-0.5 rounded-md bg-blue-950 border border-blue-700 text-blue-300 text-[10px] font-bold flex items-center gap-1 shrink-0">
          <Lock className="w-3 h-3" />
          <span>Protected</span>
        </span>
      ) : (
        <span className="text-[10px] font-mono text-slate-500 shrink-0">Select</span>
      )}
    </button>
  );
};

interface CardActionModalProps {
  card: CardInstance;
  team: Team;
  state: GameState;
  onClose: () => void;
  onDrawGiftPlayer: (
    teamId: string,
    cardId: string,
    targetTeamId: string
  ) => Promise<{ success: boolean; draft?: GiftDraft; error?: string }>;
  onExecuteCard: (
    teamId: string,
    cardId: string,
    targetTeamId?: string,
    targetStudentId?: string,
    exchangeStudentId?: string,
    requestId?: string
  ) => Promise<{ success: boolean; effect?: Record<string, any>; error?: string }>;
}

export const CardActionModal: React.FC<CardActionModalProps> = ({
  card,
  team,
  state,
  onClose,
  onDrawGiftPlayer,
  onExecuteCard,
}) => {
  const def = CARD_DEFINITIONS[card.cardType];
  const allTeams = Object.values(state.teams || {});

  const [targetTeamId, setTargetTeamId] = useState<string>('');
  const [targetStudentId, setTargetStudentId] = useState<string>('');
  const [exchangeStudentId, setExchangeStudentId] = useState<string>('');
  const [giftDraft, setGiftDraft] = useState<GiftDraft | null>(
    state.pendingGiftDrafts?.[team.id]?.cardId === card.id
      ? state.pendingGiftDrafts[team.id]
      : null
  );
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultEffect, setResultEffect] = useState<Record<string, any> | null>(null);

  const selectedTargetTeam = targetTeamId ? state.teams[targetTeamId] : undefined;
  const selectedIncomingMember = selectedTargetTeam?.members.find(
    m => m.studentId === targetStudentId
  );
  const selectedOutgoingMember = team.members.find(m => m.studentId === exchangeStudentId);

  const handleGiftTeamSelect = async (tid: string) => {
    setTargetTeamId(tid);
    setErrorMsg(null);
    setIsBusy(true);
    const res = await onDrawGiftPlayer(team.id, card.id, tid);
    setIsBusy(false);
    if (!res.success || !res.draft) {
      setErrorMsg(res.error || 'Could not draft opponent player.');
    } else {
      setGiftDraft(res.draft);
    }
  };

  const handleConfirm = async () => {
    setErrorMsg(null);
    setIsBusy(true);
    const requestId =
      card.cardType === 'player_swap'
        ? `swap-${card.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        : undefined;
    const res = await onExecuteCard(
      team.id,
      card.id,
      def.requiresTargetTeam ? targetTeamId : undefined,
      card.cardType === 'player_swap' || card.cardType === 'player_lock'
        ? targetStudentId
        : undefined,
      card.cardType === 'gift_player' || card.cardType === 'player_swap'
        ? exchangeStudentId
        : undefined,
      requestId
    );
    setIsBusy(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Action failed.');
      return;
    }

    setResultEffect(res.effect || { type: card.cardType });
  };

  const canConfirm = (): boolean => {
    if (isBusy) return false;
    switch (card.cardType) {
      case 'bonus_card':
      case 'better_luck':
        return true;
      case 'double_points':
        return state.roundPhase === 'card_window';
      case 'player_lock':
        return !!targetStudentId;
      case 'player_swap':
        return !!targetTeamId && !!targetStudentId && !!exchangeStudentId;
      case 'minus_card':
      case 'card_steal':
      case 'card_inspection':
        return !!targetTeamId;
      case 'gift_player':
        return !!giftDraft && !!exchangeStudentId;
      default:
        return false;
    }
  };

  return (
    <div className="fixed inset-0 z-[75] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border-2 border-cyan-500/50 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-widest">
              Card Activation
            </span>
            <h3 className="text-lg font-black text-white">{formatCardTitle(card)}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Result Screen after execution */}
        {resultEffect ? (
          <div className="py-4 space-y-4 text-center">
            {resultEffect.type === 'bonus_card' && (
              <div className="space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-yellow-500/20 border border-yellow-400/50 mx-auto flex items-center justify-center">
                  <Zap className="w-8 h-8 text-yellow-400" />
                </div>
                <h4 className="text-2xl font-black text-yellow-300">
                  +{resultEffect.bonusPoints} Bonus Points!
                </h4>
                <p className="text-xs text-slate-300">
                  Team score updated to{' '}
                  <span className="font-mono font-bold text-cyan-400">{resultEffect.newScore} pts</span>.
                </p>
              </div>
            )}

            {resultEffect.type === 'better_luck' && (
              <div className="space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/20 border border-cyan-400/50 mx-auto flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-cyan-400" />
                </div>
                <h4 className="text-xl font-black text-white">Next Card Opportunity Preserved!</h4>
                <p className="text-xs text-slate-300">
                  A fresh card draw opportunity has been credited to your team inventory.
                </p>
              </div>
            )}

            {resultEffect.type === 'double_points' && (
              <div className="space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-400/60 mx-auto flex items-center justify-center">
                  <ChevronsUp className="w-8 h-8 text-emerald-400" />
                </div>
                <h4 className="text-xl font-black text-emerald-300">
                  Double Points (2x Base) Armed!
                </h4>
                <p className="text-xs text-slate-300">
                  Active for Round <strong className="text-white">{resultEffect.roundNumber}</strong>. Base question points will be doubled if your answer is correct (streak, speed, and bonus effects remain normal).
                </p>
              </div>
            )}

            {resultEffect.type === 'player_lock' && (
              <div className="space-y-2">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/20 border border-blue-400/50 mx-auto flex items-center justify-center">
                  <Shield className="w-7 h-7 text-blue-400" />
                </div>
                <h4 className="text-lg font-black text-white">
                  {resultEffect.lockedStudentName} is Now Protected!
                </h4>
                <p className="text-xs text-slate-400">
                  Public protection badge is now visible across all screens.
                </p>
              </div>
            )}

            {resultEffect.type === 'card_inspection' && (
              <div className="space-y-3 text-left">
                <div className="flex items-center justify-center gap-2 text-sky-300 font-black text-sm">
                  <Eye className="w-5 h-5 text-sky-400" />
                  <span>
                    Scan Complete: {(resultEffect.inspection as InspectionSnapshot).targetTeamName}
                  </span>
                </div>
                <p className="text-[11px] text-center text-slate-400">
                  Mode: {resultEffect.inspection.mode === 'reveal_one_random' ? 'Single Random Card' : 'Full Inventory Reveal'}. Target sees anonymous surveillance alert.
                </p>
                {(resultEffect.inspection as InspectionSnapshot).cards.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(resultEffect.inspection as InspectionSnapshot).cards.map(c => (
                      <GameCard key={c.id} card={c} variant="mini" visualState="active" />
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-400">
                    Opponent currently holds 0 secret cards.
                  </div>
                )}
              </div>
            )}

            {resultEffect.type === 'gift_player' && (
              <div className="space-y-2">
                <div className="w-14 h-14 rounded-2xl bg-teal-500/20 border border-teal-400/50 mx-auto flex items-center justify-center">
                  <Gift className="w-7 h-7 text-teal-400" />
                </div>
                <h4 className="text-lg font-black text-white">Roster Trade Completed!</h4>
                <p className="text-xs text-slate-300">
                  <span className="text-emerald-400 font-bold">{resultEffect.draftedStudentName}</span> joined your team in exchange for{' '}
                  <span className="text-amber-400 font-bold">{resultEffect.tradedStudentName}</span>.
                </p>
              </div>
            )}

            {(resultEffect.type === 'player_swap' ||
              resultEffect.type === 'minus_card' ||
              resultEffect.type === 'card_steal') && (
              <div className="space-y-2">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-400/50 mx-auto flex items-center justify-center">
                  <Clock className="w-7 h-7 text-amber-400 animate-pulse" />
                </div>
                <h4 className="text-lg font-black text-white">Attack Launched — Waiting for Response</h4>
                <p className="text-xs text-slate-300">
                  Reaction window ({state.settings.reactionWindowSeconds}s) opened on{' '}
                  <span className="font-bold text-amber-300">{resultEffect.reaction?.targetTeamName}</span>.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-300">{def.descriptionEn}</p>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-950 border border-rose-700 text-rose-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Step 1: Rival Team Selection Cards */}
            {def.requiresTargetTeam && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 block">
                  1. Select Target Rival Team:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {allTeams
                    .filter(t => t.id !== team.id)
                    .map(t => {
                      const noCardsForSteal =
                        card.cardType === 'card_steal' &&
                        (t.secretCardsCount ?? t.secretCards.length) === 0;

                      return (
                        <TeamSelectionCard
                          key={t.id}
                          team={t}
                          selected={targetTeamId === t.id}
                          disabled={noCardsForSteal || (card.cardType === 'gift_player' && !!giftDraft)}
                          disabledReason={noCardsForSteal ? '0 secret cards' : undefined}
                          onSelect={() => {
                            if (card.cardType === 'gift_player') {
                              handleGiftTeamSelect(t.id);
                            } else {
                              setTargetTeamId(t.id);
                              setTargetStudentId('');
                            }
                          }}
                        />
                      );
                    })}
                </div>
              </div>
            )}

            {card.cardType === 'double_points' && (
              <div className="p-3.5 rounded-2xl bg-emerald-950/50 border border-emerald-600/60 space-y-1.5">
                <div className="flex items-center gap-2 text-emerald-300 font-black text-xs">
                  <ChevronsUp className="w-4 h-4 text-emerald-400" />
                  <span>2x Base Points Multiplier — Round {state.currentRoundNumber}</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Doubles base question points only if answered correctly. Speed bonus, streak bonus, and Bonus Question effects are not doubled.
                </p>
                {state.roundPhase !== 'card_window' && (
                  <p className="text-[11px] font-bold text-rose-400 pt-1">
                    Blocked: Double Points can ONLY be activated during the Card Window before question reveal.
                  </p>
                )}
              </div>
            )}

            {/* Player Swap: Step 1 Rival Player + Step 2 Own Outgoing Teammate + Exchange Preview */}
            {card.cardType === 'player_swap' && selectedTargetTeam && (
              <div className="space-y-4 pt-2 border-t border-slate-800">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 block">
                    2. Select Incoming Player from {selectedTargetTeam.name}:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedTargetTeam.members.map(m => (
                      <PlayerSelectionCard
                        key={m.studentId}
                        member={m}
                        selected={targetStudentId === m.studentId}
                        onSelect={() => setTargetStudentId(m.studentId)}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <label className="text-xs font-bold text-slate-300 block">
                    3. Select Outgoing Player from Your Team ({team.name}) for 1-for-1 Exchange:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {team.members.map(m => (
                      <PlayerSelectionCard
                        key={m.studentId}
                        member={m}
                        selected={exchangeStudentId === m.studentId}
                        onSelect={() => setExchangeStudentId(m.studentId)}
                      />
                    ))}
                  </div>
                </div>

                {/* Mandatory 1-for-1 Exchange Preview */}
                <div className="p-3 rounded-2xl bg-slate-950 border border-amber-500/40 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono font-bold text-amber-300">
                    <span className="flex items-center gap-1.5">
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      <span>EXCHANGE PREVIEW (1-FOR-1)</span>
                    </span>
                    <span className="text-slate-400">Rosters Stay Balanced</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded-xl bg-emerald-950/40 border border-emerald-800/60">
                      <span className="block text-[10px] font-mono text-emerald-400">INCOMING TO {team.name}</span>
                      <span className="font-bold text-white">
                        {selectedIncomingMember
                          ? `${selectedIncomingMember.name} (${selectedTargetTeam.name})`
                          : 'Select incoming rival player...'}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-amber-950/40 border border-amber-800/60">
                      <span className="block text-[10px] font-mono text-amber-400">OUTGOING TO {selectedTargetTeam.name}</span>
                      <span className="font-bold text-white">
                        {selectedOutgoingMember
                          ? `${selectedOutgoingMember.name} (${team.name})`
                          : 'Select outgoing teammate...'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Player Lock: Own Team Player Selection Cards */}
            {card.cardType === 'player_lock' && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 block">
                  Select Teammate to Protect ({team.members.filter(m => m.isLocked).length}/2 locked):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {team.members.map(m => (
                    <PlayerSelectionCard
                      key={m.studentId}
                      member={m}
                      selected={targetStudentId === m.studentId}
                      onSelect={() => setTargetStudentId(m.studentId)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Gift Player Step 2: Show Randomly Drafted Opponent & Pick Outgoing Teammate */}
            {card.cardType === 'gift_player' && giftDraft && (
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div className="p-3 rounded-2xl bg-teal-950/60 border border-teal-600/60 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-teal-400 uppercase">
                      Randomly Drafted Player
                    </span>
                    <div className="text-base font-black text-white">{giftDraft.draftedStudentName}</div>
                    <span className="text-[11px] text-slate-300">
                      Original Team: <strong className="text-cyan-300">{giftDraft.targetTeamName}</strong>
                    </span>
                  </div>
                  <Gift className="w-7 h-7 text-teal-400 shrink-0" />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 block">
                    2. Choose Which Teammate Leaves in Exchange (maintains roster size):
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {team.members.map(m => (
                      <PlayerSelectionCard
                        key={m.studentId}
                        member={m}
                        selected={exchangeStudentId === m.studentId}
                        onSelect={() => setExchangeStudentId(m.studentId)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Action Footer */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canConfirm()}
                onClick={handleConfirm}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 text-xs font-black text-white flex items-center gap-1.5 shadow-lg"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isBusy ? 'Processing...' : `Confirm ${formatCardTitle(card)}`}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

interface ReactionWindowModalProps {
  reaction: ActiveReaction;
  team: Team;
  currentRoundNumber?: number;
  onDefend: (defenseCardType: CardType) => Promise<void>;
}

export const ReactionWindowModal: React.FC<ReactionWindowModalProps> = ({
  reaction,
  team,
  currentRoundNumber = 1,
  onDefend,
}) => {
  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    Math.max(0, Math.ceil((reaction.expiresAt - Date.now()) / 1000))
  );
  const [isReacting, setIsReacting] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((reaction.expiresAt - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(timer);
  }, [reaction.expiresAt]);

  const compatibleDefenseCards = team.secretCards.filter(c => {
    if (c.cardType === 'anti_swap') return reaction.initiatingCardType === 'player_swap';
    if (c.cardType === 'reverse_judgment') {
      return (
        reaction.initiatingCardType === 'minus_card' ||
        reaction.initiatingCardType === 'player_swap' ||
        reaction.initiatingCardType === 'card_steal'
      );
    }
    return false;
  });

  const attackDescription =
    reaction.initiatingCardType === 'player_swap'
      ? `${reaction.initiatingTeamName || 'An opponent'} wants to exchange "${reaction.exchangeStudentName || 'their player'}" (${reaction.initiatingTeamName || 'Opponent'}) ↔ "${reaction.targetStudentName}" (${reaction.targetTeamName || team.name})!`
      : reaction.initiatingCardType === 'minus_card'
      ? `${reaction.initiatingTeamName || 'An opponent'} launched Minus Card (-100 pts) against your score!`
      : `${reaction.initiatingTeamName || 'An opponent'} is attempting to steal a secret card!`;

  return (
    <div className="fixed inset-0 z-[80] bg-rose-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border-2 border-rose-500 rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-4 sm:p-5 shadow-2xl space-y-3 sm:space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-rose-300 font-black text-sm">
            <ShieldAlert className="w-5 h-5 text-rose-400 animate-pulse" />
            <span>INCOMING ATTACK — REACTION WINDOW</span>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-rose-950 border border-rose-600 text-rose-200 font-mono font-black text-sm tabular-nums">
            {secondsLeft}s
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-amber-300">
            <span>STATUS: WAITING FOR RESPONSE</span>
            <span>{CARD_DEFINITIONS[reaction.initiatingCardType].titleEn}</span>
          </div>
          <p className="text-xs text-slate-100 font-semibold">{attackDescription}</p>
        </div>

        {compatibleDefenseCards.length > 0 ? (
          <div className="space-y-2">
            <span className="text-xs font-bold text-emerald-300 block">
              Play a Defense Card Immediately to Counter:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {compatibleDefenseCards.map(c => {
                const eligible = isCardEligibleForRound(c, currentRoundNumber);
                return (
                  <div key={c.id} className="space-y-1.5">
                    <GameCard
                      card={c}
                      variant="mini"
                      visualState={eligible ? 'active' : 'disabled'}
                      disabledReason={
                        eligible
                          ? undefined
                          : `Earned Round ${c.earnedInRound ?? currentRoundNumber} — usable Round ${c.availableFromRound}`
                      }
                      onClick={async () => {
                        if (isReacting || !eligible) return;
                        setIsReacting(true);
                        await onDefend(c.cardType);
                        setIsReacting(false);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 text-center">
            No compatible defense cards in your Secret Inventory. Wait for timer resolution.
          </div>
        )}
      </div>
    </div>
  );
};
