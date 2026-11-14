import React, { useEffect } from 'react';
import { Team, TeamRivalryEvent } from '../../types/game';
import { Swords, X } from 'lucide-react';

interface TeamRivalryOverlayProps {
  rivalry: TeamRivalryEvent;
  teams: Record<string, Team>;
  onDismiss: () => Promise<void>;
}

export const TeamRivalryOverlay: React.FC<TeamRivalryOverlayProps> = ({
  rivalry,
  teams,
  onDismiss,
}) => {
  const teamA = teams[rivalry.teamAId];
  const teamB = teams[rivalry.teamBId];

  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss().catch(() => {});
    }, 4500);
    return () => clearTimeout(timer);
  }, [rivalry.id]);

  return (
    <div
      data-testid="team-rivalry-overlay"
      className="fixed inset-0 z-[55] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="relative max-w-2xl w-full bg-slate-900 border-2 border-amber-500/60 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6 overflow-hidden">
        <button
          type="button"
          onClick={() => onDismiss()}
          className="absolute top-4 right-4 p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
          aria-label="Dismiss Rivalry Spotlight"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/50 text-amber-300 text-xs font-mono font-black uppercase tracking-widest">
            <Swords className="w-4 h-4 text-amber-400" />
            <span>Round {rivalry.roundNumber} Spotlight</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            TEAM RIVALRY
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 items-center gap-4">
          <div
            className="p-5 rounded-2xl bg-slate-950 border-2 space-y-1 shadow-lg"
            style={{ borderColor: teamA?.color || '#06b6d4' }}
          >
            <span className="text-[10px] font-mono uppercase text-slate-400">Challenger</span>
            <h3 className="text-xl font-black text-white truncate">
              {teamA?.name || rivalry.teamAName}
            </h3>
            <span className="block font-mono text-sm font-bold text-cyan-300 tabular-nums">
              {teamA?.score ?? 0} pts
            </span>
          </div>

          <div className="flex flex-col items-center justify-center space-y-1">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-rose-600 text-white font-black text-xl flex items-center justify-center shadow-xl shadow-amber-500/30 animate-pulse">
              VS
            </div>
          </div>

          <div
            className="p-5 rounded-2xl bg-slate-950 border-2 space-y-1 shadow-lg"
            style={{ borderColor: teamB?.color || '#f43f5e' }}
          >
            <span className="text-[10px] font-mono uppercase text-slate-400">Rival</span>
            <h3 className="text-xl font-black text-white truncate">
              {teamB?.name || rivalry.teamBName}
            </h3>
            <span className="block font-mono text-sm font-bold text-cyan-300 tabular-nums">
              {teamB?.score ?? 0} pts
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800 text-xs">
          <span className="text-slate-400">
            Visual Hype Spotlight — standard round rules, scoring, and cards apply unchanged.
          </span>
          <button
            type="button"
            onClick={() => onDismiss()}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black transition-colors shrink-0"
          >
            Continue Round
          </button>
        </div>
      </div>
    </div>
  );
};
