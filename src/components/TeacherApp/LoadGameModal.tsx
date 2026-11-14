import React, { useState, useEffect } from 'react';
import { useGame } from '../../context/GameContext';
import { FolderOpen, X, Play, Clock } from 'lucide-react';

interface LoadGameModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoadGameModal: React.FC<LoadGameModalProps> = ({ isOpen, onClose }) => {
  const { loadGame, language } = useGame();
  const isAr = language === 'ar';
  const [savedGames, setSavedGames] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/game/history')
        .then(r => r.json())
        .then(setSavedGames)
        .catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-indigo-400" />
            <h3 className="font-black text-base text-white">
              {isAr ? 'تحميل مباراة سابقة (Load Game)' : 'Load Previous Game'}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-400">
          {isAr
            ? 'عند تحميل مباراة قديمة، يتم استعادة الجولة والفرق والنقاط والأسئلة وسجل العمليات كما كانت تماماً دون إعادة توزيع.'
            : 'Restores the exact round, teams, scores, question bank, and state without re-rolling.'}
        </p>

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {savedGames.map(g => (
            <div
              key={g.gameId}
              className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 hover:border-slate-700 transition-colors"
            >
              <div>
                <h4 className="font-bold text-sm text-white">{g.name}</h4>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono mt-0.5">
                  <Clock className="w-3 h-3" />
                  <span>Round {g.currentRound}</span>
                  <span>•</span>
                  <span>{new Date(g.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <button
                onClick={async () => {
                  await loadGame(g.gameId);
                  onClose();
                }}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md"
              >
                {isAr ? 'تحميل' : 'Load'}
              </button>
            </div>
          ))}

          {savedGames.length === 0 && (
            <div className="text-center py-6 text-xs text-slate-500">
              {isAr ? 'لا توجد مباريات سابقة محفوظة' : 'No previous saved games found'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
