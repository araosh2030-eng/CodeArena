import React from 'react';
import { GameState } from '../../types/game';
import { computeTeamRankings } from '../../game/rules';
import { Crown, Lock, Users, Shield } from 'lucide-react';

interface TeamOverviewSidebarProps {
  state: GameState;
  currentTeamId: string;
}

/**
 * Right Collapsible Sidebar:
 * Displays all 4 teams, scores, official leaders, and public player lock badges.
 * Strictly NEVER displays opponent secret card inventories.
 */
export const TeamOverviewSidebar: React.FC<TeamOverviewSidebarProps> = ({
  state,
  currentTeamId,
}) => {
  const rankings = computeTeamRankings(state.teams || {});

  return (
    <div className="flex flex-col h-full space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-200">
            Teams & Shields
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-500">4 Teams</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
        {rankings.map(entry => {
          const t = state.teams[entry.teamId];
          if (!t) return null;
          const isOwn = t.id === currentTeamId;
          return (
            <div
              key={t.id}
              className={`rounded-2xl border p-2.5 space-y-2 ${
                isOwn
                  ? 'bg-cyan-950/35 border-cyan-500/50'
                  : 'bg-slate-950/75 border-slate-800'
              }`}
              style={{ borderLeft: `3px solid ${t.color}` }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[10px] font-mono text-slate-400">#{entry.rank}</span>
                  <h4 className="font-black text-xs text-white truncate">
                    {t.name} {isOwn && <span className="text-cyan-400">(You)</span>}
                  </h4>
                </div>
                <span className="font-mono font-black text-xs text-cyan-300 tabular-nums shrink-0">
                  {t.score}
                </span>
              </div>

              <div className="space-y-1">
                {t.members.map(m => (
                  <div
                    key={m.studentId}
                    className="flex items-center justify-between gap-1 text-[11px] text-slate-300"
                  >
                    <span className="truncate">{m.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {m.isLeader && (
                        <span
                          className="px-1.5 py-0.2 rounded bg-amber-950 border border-amber-700/70 text-amber-300 text-[9px] font-bold flex items-center gap-0.5"
                          title="Team Leader"
                        >
                          <Crown className="w-2.5 h-2.5" />
                        </span>
                      )}
                      {m.isLocked && (
                        <span
                          className="px-1.5 py-0.2 rounded bg-blue-950 border border-blue-700/70 text-blue-300 text-[9px] font-bold flex items-center gap-0.5"
                          title="Protected by Player Lock"
                        >
                          <Lock className="w-2.5 h-2.5" />
                          <span>Locked</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800 text-[10px] text-slate-400 flex items-center gap-1.5">
        <Shield className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span>Blue lock badges mark players shielded from swaps.</span>
      </div>
    </div>
  );
};
