import React, { useState, useEffect } from 'react';
import { TeamMember } from '../../types/game';
import { Crown, Users, ShieldAlert, ArrowRight, LogOut, RefreshCw, Smartphone } from 'lucide-react';

interface AvailableTeamSummary {
  teamId: string;
  teamNumber: number;
  name: string;
  color: string;
  leaderStudentId: string;
  leaderName: string;
  membersCount: number;
  members: TeamMember[];
  score: number;
  hasActiveSession: boolean;
  activeSessionOperator: string | null;
  activeSessionUserId: string | null;
}

interface TeamSelectScreenProps {
  user: { id: string; email: string; displayName?: string };
  token: string | null;
  onTeamJoined: (teamId: string) => void;
  onLogout: () => void;
}

export const TeamSelectScreen: React.FC<TeamSelectScreenProps> = ({
  user,
  token,
  onTeamJoined,
  onLogout,
}) => {
  const [teams, setTeams] = useState<AvailableTeamSummary[]>([]);
  const [gameName, setGameName] = useState<string>('CodeArena Match');
  const [loading, setLoading] = useState<boolean>(true);
  const [operatorName, setOperatorName] = useState<string>(user.displayName || '');
  const [error, setError] = useState<string | null>(null);
  const [conflictTeam, setConflictTeam] = useState<{
    teamId: string;
    teamName: string;
    existingOperator: string;
  } | null>(null);

  const fetchTeams = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/game/teams/available');
      const data = await res.json();
      setTeams(data.teams || []);
      if (data.gameName) setGameName(data.gameName);
    } catch (err: any) {
      setError(err.message || 'Failed to load active teams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, []);

  const joinTeam = async (teamId: string, forceTakeover = false) => {
    setError(null);
    try {
      const res = await fetch('/api/game/team/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          teamId,
          userId: user.id,
          operatorName: operatorName.trim() || undefined,
          forceTakeover,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.conflict) {
        const matched = teams.find(t => t.teamId === teamId);
        setConflictTeam({
          teamId,
          teamName: matched?.name || teamId,
          existingOperator: data.existingOperator || 'Another device',
        });
        return;
      }
      if (!res.ok) {
        setError(data.error || 'Could not join selected team.');
        return;
      }
      setConflictTeam(null);
      onTeamJoined(teamId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 flex flex-col justify-center">
      <div className="max-w-4xl w-full mx-auto space-y-5">
        {/* Header */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-widest">
                {gameName}
              </span>
              <h2 className="text-lg font-black text-white">Select Your Team</h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400 hidden sm:inline">{user.email}</span>
            <button
              type="button"
              onClick={fetchTeams}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="Refresh teams"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Optional Phone Operator Name (Explicitly separate from Official Team Leader) */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <label htmlFor="operator-name" className="text-xs font-bold text-slate-200 block">
              Phone Operator Label (Optional)
            </label>
            <span className="text-[11px] text-slate-400">
              Identifies this device session only. Official team roster & leader remain unchanged.
            </span>
          </div>
          <input
            id="operator-name"
            type="text"
            value={operatorName}
            onChange={e => setOperatorName(e.target.value)}
            placeholder="e.g. Leader Device #1"
            className="sm:w-64 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
          />
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-950 border border-rose-700 text-rose-200 text-xs">
            {error}
          </div>
        )}

        {/* 4 Dynamic Team Cards */}
        {teams.length === 0 && !loading ? (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center space-y-2">
            <p className="text-sm font-bold text-white">No teams have been formed in the current match yet.</p>
            <p className="text-xs text-slate-400">
              Ask the teacher to complete team formation in the setup wizard, then tap refresh.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {teams.map(t => {
              const isOwnSession = t.activeSessionUserId === user.id;
              const isTakenByOther = t.hasActiveSession && !isOwnSession;

              return (
                <div
                  key={t.teamId}
                  className="bg-slate-900 border border-slate-800 rounded-3xl p-4 flex flex-col justify-between space-y-3 shadow-xl"
                  style={{ borderTop: `4px solid ${t.color}` }}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                        Team #{t.teamNumber}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                          isOwnSession
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                            : isTakenByOther
                            ? 'bg-amber-950 text-amber-300 border-amber-700'
                            : 'bg-cyan-950 text-cyan-300 border-cyan-800'
                        }`}
                      >
                        {isOwnSession ? 'Your Session' : isTakenByOther ? 'Active Device' : 'Available'}
                      </span>
                    </div>

                    <h3 className="text-lg font-black text-white truncate">{t.name}</h3>

                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-300 font-bold">
                        <Crown className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{t.leaderName}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          <span>{t.membersCount} Members</span>
                        </span>
                        <span className="text-cyan-400 font-bold">{t.score} pts</span>
                      </div>
                    </div>

                    {isTakenByOther && t.activeSessionOperator && (
                      <p className="text-[10px] text-amber-300/90 font-mono truncate">
                        In use by: {t.activeSessionOperator}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => joinTeam(t.teamId, false)}
                    className={`w-full py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all ${
                      isTakenByOther
                        ? 'bg-amber-600/90 hover:bg-amber-500 text-slate-950'
                        : 'bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-lg'
                    }`}
                  >
                    <span>
                      {isOwnSession
                        ? 'Resume Team Control'
                        : isTakenByOther
                        ? 'Request Handover'
                        : 'Join Team'}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Secure Session Takeover / Handover Modal */}
      {conflictTeam && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-amber-500/60 rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-amber-300 font-black text-sm">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              <span>Active Team Session Detected</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              <strong className="text-white">{conflictTeam.teamName}</strong> is currently controlled by{' '}
              <span className="font-mono text-amber-300">{conflictTeam.existingOperator}</span>. Do you want to securely take over leader control on this device?
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConflictTeam(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => joinTeam(conflictTeam.teamId, true)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black"
              >
                Take Over Control
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
