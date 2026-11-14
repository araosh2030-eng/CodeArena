import React from 'react';
import { CardInstance, CardType } from '../../types/game';
import { CARD_DEFINITIONS } from '../../game/defaultData';
import { formatCardTitle } from '../../game/rules';
import { CARD_VISUAL_THEMES } from './cardTheme';
import {
  Repeat,
  ShieldCheck,
  ShieldAlert,
  Zap,
  TrendingDown,
  RefreshCw,
  Sparkles,
  Gift,
  HelpCircle,
  Eye,
  Lock,
  ChevronsUp
} from 'lucide-react';

export type CardVisualState = 'normal' | 'hover' | 'selected' | 'active' | 'disabled' | 'used';

interface GameCardProps {
  card: CardInstance;
  variant?: 'full' | 'mini';
  visualState?: CardVisualState;
  onClick?: () => void;
  disabledReason?: string;
  className?: string;
}

function CardArtwork({ type, accentHex }: { type: CardType; accentHex: string }) {
  const iconProps = { className: 'w-9 h-9', style: { color: accentHex } };

  switch (type) {
    case 'player_swap':
      return <Repeat {...iconProps} />;
    case 'player_lock':
      return <ShieldCheck {...iconProps} />;
    case 'anti_swap':
      return <ShieldAlert {...iconProps} />;
    case 'bonus_card':
      return <Zap {...iconProps} />;
    case 'minus_card':
      return <TrendingDown {...iconProps} />;
    case 'reverse_judgment':
      return <RefreshCw {...iconProps} />;
    case 'card_steal':
      return <Sparkles {...iconProps} />;
    case 'gift_player':
      return <Gift {...iconProps} />;
    case 'better_luck':
      return <HelpCircle {...iconProps} />;
    case 'card_inspection':
      return <Eye {...iconProps} />;
    case 'double_points':
      return <ChevronsUp {...iconProps} />;
  }
}

export const GameCard: React.FC<GameCardProps> = ({
  card,
  variant = 'full',
  visualState = 'normal',
  onClick,
  disabledReason,
  className = '',
}) => {
  const def = CARD_DEFINITIONS[card.cardType];
  const theme = CARD_VISUAL_THEMES[card.cardType];
  const displayTitle = formatCardTitle(card);

  const isDisabled = visualState === 'disabled' || visualState === 'used';

  const stateClasses: Record<CardVisualState, string> = {
    normal: 'hover:-translate-y-1 hover:shadow-xl cursor-pointer',
    hover: '-translate-y-1 shadow-xl cursor-pointer',
    selected: 'ring-2 ring-cyan-400 scale-[1.02] shadow-2xl cursor-pointer',
    active: 'ring-2 ring-emerald-400 shadow-2xl animate-pulse cursor-pointer',
    disabled: 'opacity-45 grayscale cursor-not-allowed',
    used: 'opacity-35 grayscale cursor-not-allowed',
  };

  if (variant === 'mini') {
    return (
      <button
        type="button"
        onClick={isDisabled ? undefined : onClick}
        disabled={isDisabled}
        title={disabledReason || def.descriptionEn}
        className={`w-full text-left rounded-2xl border bg-gradient-to-br p-2.5 transition-all flex items-center gap-3 ${theme.bgGradient} ${theme.borderClass} ${theme.glowShadow} ${stateClasses[visualState]} ${className}`}
      >
        <div
          className="w-10 h-10 rounded-xl bg-slate-950/80 border border-white/10 flex items-center justify-center shrink-0 shadow-inner"
        >
          <div className="scale-75">
            <CardArtwork type={card.cardType} accentHex={theme.accentHex} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-bold text-xs text-white truncate">{displayTitle}</span>
            <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${theme.badgeClass}`}>
              {theme.categoryLabel}
            </span>
          </div>
          <span className="block text-[10px] font-mono text-slate-400 truncate mt-0.5">
            {disabledReason || theme.shortTag}
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      title={disabledReason || def.descriptionEn}
      className={`relative w-52 rounded-3xl border-2 bg-gradient-to-b p-3 text-left transition-all flex flex-col justify-between overflow-hidden shadow-xl ${theme.bgGradient} ${theme.borderClass} ${theme.glowShadow} ${stateClasses[visualState]} ${className}`}
      style={{ aspectRatio: '3 / 4' }}
    >
      {/* Top Bar: Category + Copy Number */}
      <div className="flex items-center justify-between gap-2 z-10">
        <span className={`text-[9px] font-mono font-black px-2 py-0.5 rounded-md border tracking-wider ${theme.badgeClass}`}>
          {theme.categoryLabel}
        </span>
        {card.cardType === 'player_swap' && (
          <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded-md bg-slate-950/90 text-amber-300 border border-amber-500/40">
            COPY {card.copyNumber === 2 ? 'II' : 'I'}
          </span>
        )}
      </div>

      {/* Central Artwork Arena */}
      <div className="relative my-2 flex-1 rounded-2xl bg-slate-950/75 border border-white/10 flex flex-col items-center justify-center overflow-hidden shadow-inner">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background: `radial-gradient(circle at center, ${theme.accentHex}, transparent 70%)`,
          }}
        />
        <div className="relative z-10 w-16 h-16 rounded-2xl bg-slate-900/90 border border-white/15 flex items-center justify-center shadow-lg">
          <CardArtwork type={card.cardType} accentHex={theme.accentHex} />
        </div>
        <span className="relative z-10 mt-2 text-[9px] font-mono font-bold tracking-[0.18em] text-slate-400 uppercase">
          {theme.shortTag}
        </span>
      </div>

      {/* Title & Rule Effect */}
      <div className="space-y-1 z-10 bg-slate-950/85 rounded-xl p-2 border border-white/10">
        <h4 className="font-black text-xs text-white truncate">{displayTitle}</h4>
        <p className="text-[10px] text-slate-300 leading-snug line-clamp-3">
          {def.descriptionEn}
        </p>
      </div>

      {/* Disabled / Used Stamp */}
      {isDisabled && (
        <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center z-20">
          <span className="px-3 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[10px] font-mono font-black text-slate-300 uppercase flex items-center gap-1">
            <Lock className="w-3 h-3" />
            <span>{visualState === 'used' ? 'USED' : 'LOCKED'}</span>
          </span>
        </div>
      )}
    </button>
  );
};
