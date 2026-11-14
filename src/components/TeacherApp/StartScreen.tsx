import React, { useState, useEffect } from 'react';
import { useGame } from '../../context/GameContext';
import { Play, FolderOpen, LogOut, Volume2, VolumeX, Globe, Terminal, Sparkles, Trophy, Shield } from 'lucide-react';

interface StartScreenProps {
  onLoadGameClick: () => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onLoadGameClick }) => {
  const { startWizard, language, setLanguage, isMuted, toggleMute } = useGame();
  const isAr = language === 'ar';

  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-6 relative overflow-hidden select-none">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header Tools */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest">
            Applied Tech Applied Arena
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          <button
            onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-200 hover:text-white transition-colors"
          >
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>{language === 'ar' ? 'English' : 'العربية'}</span>
          </button>
        </div>
      </header>

      {/* Center Hero Lockup & Main Choices */}
      <div className="max-w-xl w-full mx-auto text-center z-10 space-y-8 my-auto py-12">
        <div className="space-y-4">
          <div className="inline-flex items-center justify-center p-3.5 rounded-2xl bg-gradient-to-tr from-cyan-500/20 via-indigo-500/20 to-purple-500/20 border border-cyan-500/30 shadow-2xl shadow-cyan-500/10">
            <Terminal className="w-10 h-10 text-cyan-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight text-white uppercase font-sans">
              Code<span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-500">Arena</span>
            </h1>
            <p className="text-sm md:text-base text-slate-400 font-medium tracking-wide">
              {isAr
                ? 'مسابقة البرمجة التفاعلية — مدرسة التكنولوجيا التطبيقية'
                : 'Applied Tech Interactive Programming Competition'}
            </p>
          </div>
        </div>

        {/* 3 Main Start Screen Choices */}
        <div className="space-y-3.5 max-w-sm mx-auto">
          {/* 1. New Game */}
          <button
            onClick={() => startWizard()}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-black text-base shadow-xl shadow-cyan-500/25 flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Play className="w-5 h-5 fill-white" />
            <span>{isAr ? 'مباراة جديدة (New Game)' : 'New Game'}</span>
          </button>

          {/* 2. Load Game */}
          <button
            onClick={onLoadGameClick}
            className="w-full py-3.5 px-6 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 font-bold text-sm shadow-md flex items-center justify-center gap-3 transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            <FolderOpen className="w-4 h-4 text-indigo-400" />
            <span>{isAr ? 'تحميل مباراة (Load Game)' : 'Load Game'}</span>
          </button>

          {/* 3. Quit */}
          <button
            onClick={() => setShowQuitConfirm(true)}
            className="w-full py-3 px-6 rounded-2xl bg-slate-950/80 hover:bg-rose-950/50 border border-slate-800 hover:border-rose-800 text-slate-400 hover:text-rose-300 font-semibold text-xs flex items-center justify-center gap-2 transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{isAr ? 'خروج (Quit)' : 'Quit'}</span>
          </button>
        </div>
      </div>

      {/* Footer System Status */}
      <footer className="w-full max-w-5xl mx-auto flex items-center justify-between text-xs text-slate-500 font-mono z-10 pt-4 border-t border-slate-900">
        <span>CodeArena Arena Engine v2.0</span>
        <span>Classroom Display & Mobile Portal Architecture</span>
      </footer>

      {/* Quit Modal */}
      {showQuitConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl">
            <h3 className="text-base font-black text-white">
              {isAr ? 'تأكيد الخروج' : 'Confirm Exit'}
            </h3>
            <p className="text-xs text-slate-400">
              {isAr
                ? 'هل تريد مغادرة شاشة المسابقة؟ يمكنك البدء في أي وقت بالضغط على New Game.'
                : 'Exit competition interface? You can start anytime via New Game.'}
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setShowQuitConfirm(false)}
                className="w-1/2 py-2.5 rounded-xl bg-slate-800 text-xs font-bold text-slate-300 hover:bg-slate-700"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={() => setShowQuitConfirm(false)}
                className="w-1/2 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-lg"
              >
                {isAr ? 'تأكيد الخروج' : 'Exit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
