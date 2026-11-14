import React, { useEffect, useState } from 'react';
import { CardInstance } from '../../types/game';
import { formatCardTitle } from '../../game/rules';
import { CardBack } from './CardBack';
import { GameCard } from './GameCard';
import { Sparkles, X } from 'lucide-react';

interface CardRevealAnimationProps {
  card: CardInstance;
  onClose: () => void;
}

export const CardRevealAnimation: React.FC<CardRevealAnimationProps> = ({ card, onClose }) => {
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setFlipped(true), 450);
    return () => clearTimeout(timer);
  }, [card.id]);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="max-w-2xl w-full flex flex-col sm:flex-row [@media(max-height:520px)]:flex-row items-center justify-center gap-4 sm:gap-7 text-center sm:text-left">
        {/* 3D Flip Container */}
        <div
          className="relative w-44 h-60 sm:w-52 sm:h-72 [@media(max-height:480px)]:w-44 [@media(max-height:480px)]:h-60 shrink-0 cursor-pointer"
          style={{ perspective: '1200px' }}
          onClick={() => setFlipped(true)}
        >
          <div
            className="relative w-full h-full transition-transform duration-700"
            style={{
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <CardBack size="lg" />
            </div>

            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                backfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <GameCard card={card} variant="full" visualState="active" />
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center sm:items-start space-y-3 max-w-xs">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-mono font-black uppercase tracking-widest">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>New Strategic Card Drawn</span>
          </div>

          <div className="space-y-1">
            <h3 className="text-lg sm:text-xl font-black text-white">
              {flipped ? formatCardTitle(card) : 'Unlocking Mystery Card...'}
            </h3>
            <p className="text-xs text-slate-400">
              Stored safely inside your Secret Card Inventory.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg flex items-center gap-1.5"
          >
            <X className="w-4 h-4" />
            <span>Store in Inventory</span>
          </button>
        </div>
      </div>
    </div>
  );
};
