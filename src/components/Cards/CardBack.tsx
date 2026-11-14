import React from 'react';

interface CardBackProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const CardBack: React.FC<CardBackProps> = ({ size = 'md', className = '' }) => {
  const sizeClasses =
    size === 'sm'
      ? 'w-16 h-24 rounded-xl p-1.5'
      : size === 'lg'
      ? 'w-52 h-72 rounded-3xl p-3'
      : 'w-32 h-44 rounded-2xl p-2';

  return (
    <div
      className={`relative bg-[#070d1f] border-2 border-cyan-500/50 shadow-xl shadow-cyan-950/60 overflow-hidden select-none flex items-center justify-center ${sizeClasses} ${className}`}
    >
      {/* Geometric Circuit Pattern SVG */}
      <svg
        viewBox="0 0 120 160"
        className="absolute inset-0 w-full h-full opacity-30 pointer-events-none"
        fill="none"
      >
        <defs>
          <pattern id="ca-circuit" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M12 0V8M12 16V24M0 12H8M16 12H24" stroke="#22d3ee" strokeWidth="0.8" />
            <circle cx="12" cy="12" r="2.2" stroke="#38bdf8" strokeWidth="0.9" />
          </pattern>
        </defs>
        <rect width="120" height="160" fill="url(#ca-circuit)" />
        <rect x="8" y="8" width="104" height="144" rx="10" stroke="#0ea5e9" strokeWidth="1" strokeDasharray="4 3" />
      </svg>

      {/* Inner Emblem Frame */}
      <div className="relative z-10 w-full h-full rounded-xl border border-cyan-400/30 bg-slate-950/60 backdrop-blur-xs flex flex-col items-center justify-center gap-1.5">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30 border border-cyan-300/40">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M8 9l-3 3 3 3M16 9l3 3-3 3M13 7l-2 10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {size !== 'sm' && (
          <div className="text-center">
            <span className="block text-[9px] font-mono font-extrabold tracking-[0.22em] text-cyan-300 uppercase">
              CODEARENA
            </span>
            <span className="block text-[8px] font-mono text-slate-500 tracking-widest uppercase">
              SECRET CARD
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
