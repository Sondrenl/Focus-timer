import confetti from 'canvas-confetti';

/**
 * Fires a pleasant pastel confetti burst to celebrate completing a focus session.
 */
export function triggerCompletionConfetti(): void {
  try {
    confetti({
      particleCount: 70,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#6750A4', '#D0BCFF', '#7D5260', '#FFD8E4', '#486581', '#38B2AC'],
    });
  } catch (err) {
    console.warn('Confetti trigger failed:', err);
  }
}
