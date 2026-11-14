import React, { useState, useRef, useEffect } from 'react';
import { useGame } from '../../context/GameContext';
import { soundEffects, SoundCategory } from '../../utils/audio';
import { Volume2, VolumeX, SlidersHorizontal, Play } from 'lucide-react';

export const SoundSettingsPopover: React.FC = () => {
  const { isMuted, toggleMute, soundSettings, updateSoundSettings, setSoundCategoryEnabled } = useGame();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', onDocClick);
    }
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const categories: Array<{ key: SoundCategory; label: string }> = [
    { key: 'gameplay', label: 'Gameplay & Reveals' },
    { key: 'cards', label: 'Cards & Swaps' },
    { key: 'events', label: 'Rivalry, Comeback & Lead' },
    { key: 'ceremony', label: 'Final Ceremony' },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-1 bg-slate-800 rounded-xl p-0.5 border border-slate-700">
        <button
          type="button"
          onClick={toggleMute}
          className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300 transition-colors"
          title={isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
          aria-label={isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
        >
          {isMuted ? (
            <VolumeX className="w-4 h-4 text-rose-400" />
          ) : (
            <Volume2 className="w-4 h-4 text-emerald-400" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className={`p-1.5 rounded-lg hover:bg-slate-700 transition-colors ${
            open ? 'bg-slate-700 text-cyan-300' : 'text-slate-400 hover:text-white'
          }`}
          title="Sound Settings"
          aria-label="Sound Settings"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div
          dir="ltr"
          className="absolute right-0 mt-2 w-72 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-4 z-50 space-y-3.5"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-black uppercase tracking-wider text-white">
              Broadcast Audio Controls
            </span>
            <button
              type="button"
              onClick={() => {
                soundEffects.unlockAudio();
                soundEffects.playSoundEvent('correct_answer');
              }}
              className="px-2 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-[10px] font-bold text-cyan-300 flex items-center gap-1"
            >
              <Play className="w-2.5 h-2.5 fill-cyan-300" />
              <span>Test Cue</span>
            </button>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-slate-300">
                <label htmlFor="master-volume-slider" className="font-bold">
                  Master Volume
                </label>
                <span className="font-mono text-cyan-300 tabular-nums">
                  {Math.round(soundSettings.masterVolume * 100)}%
                </span>
              </div>
              <input
                id="master-volume-slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(soundSettings.masterVolume * 100)}
                onChange={e =>
                  updateSoundSettings({ masterVolume: Number(e.target.value) / 100 })
                }
                className="w-full accent-cyan-400"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-slate-300">
                <label htmlFor="sfx-volume-slider" className="font-bold">
                  SFX Volume
                </label>
                <span className="font-mono text-cyan-300 tabular-nums">
                  {Math.round(soundSettings.sfxVolume * 100)}%
                </span>
              </div>
              <input
                id="sfx-volume-slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(soundSettings.sfxVolume * 100)}
                onChange={e =>
                  updateSoundSettings({ sfxVolume: Number(e.target.value) / 100 })
                }
                className="w-full accent-emerald-400"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
              Sound Categories
            </span>
            {categories.map(cat => {
              const enabled = soundSettings.categories[cat.key];
              return (
                <label
                  key={cat.key}
                  className="flex items-center justify-between text-xs text-slate-200 py-1 cursor-pointer"
                >
                  <span>{cat.label}</span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => setSoundCategoryEnabled(cat.key, e.target.checked)}
                    className="rounded accent-cyan-500 w-4 h-4"
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
