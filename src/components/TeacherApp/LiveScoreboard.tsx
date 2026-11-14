import React, { useEffect, useRef, useState } from 'react';
import { GameState } from '../../types/game';
import { computeTeamRankings } from '../../game/rules';
import { Crown, Flame, ChevronsUp, BarChart3 } from 'lucide-react';

interface LiveScoreboardProps {
  state: GameState;
  isAr?: boolean;
}

export const LiveScoreboard: React.FC<LiveScoreboardProps> = ({ state, isAr = false }) => {
  const rankings = computeTeamRankings(state.teams || {});
  const prevScoresRef = useRef<Record<string, number>>({});
  const [deltas, setDeltas] = useState<Record<string, number>>({});

  useEffect(() => {
    const nextDeltas: Record<string, number> = {};
    for (const entry of rankings) {
      const prev = prevScoresRef.current[entry.teamId];
      if (prev !== undefined && prev !== entry.score) {
        nextDeltas[entry.teamId] = entry.score - prev;
      }
      prevScoresRef.current[entry.teamId] = entry.score;
    }
    if (Object.keys(nextDeltas).length > 0) {
      setDeltas(prev => ({ ...prev, ...nextDeltas }));
      const timer = setTimeout(() => {
        setDeltas(current => {
          const copy = { ...current };
          for (const k of Object.keys(nextDeltas)) {
            delete copy[k];
          }
          return copy;
        });
      }, 2400);
      return () => clearTimeout(timer);
    }
  }, [state.teams]);

  const leaderCount = rankings.filter(r => r.rank === 1).length;

  return (
    <section
      aria-label="Live Scoreboard"
      className="bg-slate-900/95 border border-slate-800 rounded-3xl p-3.5 sm:p-4 shadow-xl space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-200">
            {isAr ? 'لوحة الترتيب المباشرة' : 'Live Standings'}
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          {leaderCount > 1
            ? isAr
              ? `تعادل على الصدارة (${leaderCount} فرق)`
              : `${leaderCount}-Way Tie for 1st`
            : isAr
            ? 'تحديث فوري'
            : 'Real-Time'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {rankings.map(entry => {
          const team = state.teams[entry.teamId];
          const delta = deltas[entry.teamId];
          const isDoubleArmed =
            state.activeDoublePointsByTeam?.[entry.teamId]?.roundNumber === state.currentRoundNumber;

          return (
            <div
              key={entry.teamId}
              data-testid={`scoreboard-row-${entry.teamId}`}
              className={`relative rounded-2xl border px-3 py-2.5 transition-all flex items-center justify-between gap-2 ${
                entry.isLeader
                  ? 'bg-gradient-to-br from-amber-950/45 via-slate-950 to-slate-950 border-amber-500/60 shadow-lg shadow-amber-500/10'
                  : 'bg-slate-950/85 border-slate-800'
              }`}
              style={{ borderLeft: `4px solid ${entry.color}` }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-7 h-7 rounded-xl font-mono font-black text-xs flex items-center justify-center shrink-0 ${
                    entry.rank === 1
                      ? 'bg-amber-500 text-slate-950'
                      : entry.rank === 2
                      ? 'bg-slate-300 text-slate-950'
                      : entry.rank === 3
                      ? 'bg-amber-700 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  #{entry.rank}
                </span>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-xs text-white truncate">{entry.teamName}</span>
                    {entry.isLeader && (
                      <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    )}
                    {team && team.streak >= 3 && (
                      <span className="text-[10px] font-mono font-black text-amber-300 flex items-center gap-0.5 shrink-0">
                        <Flame className="w-3 h-3 fill-amber-400 text-amber-400" />
                        <span>{team.streak}</span>
                      </span>
                    )}
                    {isDoubleArmed && (
                      <span
                        className="px-1 py-0.2 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 text-[9px] font-mono font-black flex items-center shrink-0"
                        title="Double Points 2x Armed"
                      >
                        <ChevronsUp className="w-2.5 h-2.5" />
                        2X
                      </span>
                    )}
                  </div>
                  <span className="block text-[10px] font-mono text-slate-400 tabular-nums">
                    {entry.diffFromLeader === 0
                      ? entry.isLeader && leaderCount > 1
                        ? 'Tied 1st'
                        : 'Leader'
                      : `${entry.diffFromLeader} pts behind`}
                  </span>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="font-mono font-black text-base text-cyan-300 tabular-nums">
                  {entry.score}
                </span>
                {delta !== undefined && delta !== 0 && (
                  <span
                    className={`block text-[10px] font-mono font-black tabular-nums animate-bounce ${
                      delta > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
