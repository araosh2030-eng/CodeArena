import React, { useState, useEffect } from 'react';
import { GameProvider, useGame } from './context/GameContext';
import { StartScreen } from './components/TeacherApp/StartScreen';
import { NewGameWizard } from './components/TeacherApp/NewGameWizard';
import { UnifiedTeacherScreen } from './components/TeacherApp/UnifiedTeacherScreen';
import { LoadGameModal } from './components/TeacherApp/LoadGameModal';
import { TeamMobilePortal } from './components/MobilePortal/TeamMobilePortal';
import { SoundSettingsPopover } from './components/TeacherApp/SoundSettingsPopover';
import { ExternalLink, Globe, Wifi, WifiOff } from 'lucide-react';

const TeacherHeader: React.FC = () => {
  const { state, language, setLanguage, connected } = useGame();
  const isAr = language === 'ar';

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 select-none px-4 py-2 flex items-center justify-between gap-3 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center font-black text-white text-sm shadow-md">
          CA
        </div>
        <div>
          <h1 className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
            <span>{isAr ? 'كود أرينا' : 'CodeArena'}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono">
              Teacher Suite
            </span>
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Helper to open mobile phone portal */}
        <a
          href={`/play?gameId=${state?.gameId || ''}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-cyan-300 hover:text-white border border-slate-700 transition-colors"
          title="Open Mobile Portal for testing"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{isAr ? 'بوابة هواتف الفرق' : 'Team Mobile Portal'}</span>
        </a>

        {/* Audio Mute & Mixer */}
        <SoundSettingsPopover />

        {/* Language */}
        <button
          onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200"
        >
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span>{language === 'ar' ? 'EN' : 'عربي'}</span>
        </button>

        {/* Live indicator */}
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-mono font-medium ${
            connected
              ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-800/60'
              : 'text-rose-400 bg-rose-950/60 border border-rose-800/60'
          }`}
        >
          {connected ? <Wifi className="w-3 h-3 animate-pulse" /> : <WifiOff className="w-3 h-3" />}
          <span className="hidden md:inline">{connected ? (isAr ? 'مباشر' : 'Live') : 'Offline'}</span>
        </div>
      </div>
    </header>
  );
};

const MainAppContent: React.FC = () => {
  const { state, language } = useGame();
  const isAr = language === 'ar';
  const [showLoadModal, setShowLoadModal] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [state?.status, state?.wizard?.step, state?.currentRoundNumber]);

  // Check if we are viewing the external Mobile Team Portal
  const isMobilePortalRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/play') ||
      window.location.search.includes('portal=team') ||
      window.location.search.includes('gameId='));

  if (isMobilePortalRoute) {
    return (
      <div className="min-h-screen bg-slate-950 font-sans" dir="ltr">
        <TeamMobilePortal />
      </div>
    );
  }

  // Teacher Experience
  return (
    <div
      className={`min-h-screen bg-slate-950 text-slate-100 ${isAr ? 'font-cairo' : 'font-sans'}`}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <TeacherHeader />

      <main className="w-full">
        {(!state || state.status === 'start_menu') && (
          <StartScreen onLoadGameClick={() => setShowLoadModal(true)} />
        )}

        {state?.status === 'wizard' && <NewGameWizard />}

        {state?.status === 'ready' && state.wizard?.step === 6 && <NewGameWizard />}

        {(state?.status === 'in_progress' || state?.status === 'paused' || state?.status === 'completed' || (state?.status === 'ready' && (!state.wizard || state.wizard.step !== 6))) && (
          <UnifiedTeacherScreen />
        )}
      </main>

      <LoadGameModal isOpen={showLoadModal} onClose={() => setShowLoadModal(false)} />
    </div>
  );
};

export default function App() {
  return (
    <GameProvider>
      <MainAppContent />
    </GameProvider>
  );
}
