import React, { useEffect, useState } from 'react';
import { RotateCw, Maximize2 } from 'lucide-react';

export const OrientationGuard: React.FC = () => {
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const check = () => {
      const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 768;
      setIsPortraitMobile(portrait);
      if (!portrait) {
        setDismissed(false);
      }
    };

    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  const attemptLandscapeLock = async () => {
    try {
      const docEl = document.documentElement as any;
      if (docEl.requestFullscreen && !document.fullscreenElement) {
        await docEl.requestFullscreen().catch(() => {});
      }
      const orientation = screen.orientation as any;
      if (orientation && typeof orientation.lock === 'function') {
        await orientation.lock('landscape').catch(() => {});
      }
    } catch {
      // Gracefully ignore on browsers that disallow orientation lock outside fullscreen
    }
  };

  if (!isPortraitMobile || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-6 text-center">
      <div className="max-w-xs w-full bg-slate-900 border border-cyan-500/40 rounded-3xl p-6 space-y-4 shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-cyan-950 border border-cyan-500/50 mx-auto flex items-center justify-center text-cyan-400">
          <RotateCw className="w-8 h-8 animate-spin" style={{ animationDuration: '4s' }} />
        </div>
        <h3 className="text-lg font-black text-white">Landscape Mode Recommended</h3>
        <p className="text-xs text-slate-300 leading-relaxed">
          Please rotate your device to landscape mode for the horizontal CodeArena HUD.
        </p>
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={attemptLandscapeLock}
            className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Lock Landscape View</span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs"
          >
            Continue Anyway
          </button>
        </div>
      </div>
    </div>
  );
};
