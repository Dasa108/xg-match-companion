// A one-shot confetti burst, fired when a goal is logged. No animation library — same
// "key-remount restarts it" pattern as the live-xG pop (styles.css .pop): the parent gives
// this component a fresh `key` per goal, so each goal gets its own random piece layout and
// its own timer from zero, and this component unmounts itself (returns null) once the
// longest piece's fall animation is done, so it never lingers as dead, pointer-events:none
// DOM the user could otherwise never see or reason about.
import { useEffect, useState } from "react";

const COLORS = ["var(--home)", "var(--away)", "var(--pos)", "var(--accent-bright)", "var(--post)"];
const PIECE_COUNT = 46;
const LIFETIME_MS = 2400;

interface Piece {
  left: number;
  delay: number;
  duration: number;
  drift: number;
  rotate: number;
  color: string;
  round: boolean;
}

function makePieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, () => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.3,
    duration: 1.5 + Math.random() * 0.9,
    drift: (Math.random() - 0.5) * 160,
    rotate: 360 + Math.random() * 360,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    round: Math.random() > 0.5,
  }));
}

export function Confetti() {
  const [pieces] = useState(makePieces);
  const [alive, setAlive] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setAlive(false), LIFETIME_MS);
    return () => clearTimeout(t);
  }, []);

  if (!alive) return null;

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`confetti-piece ${p.round ? "round" : ""}`}
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ["--drift" as string]: `${p.drift}px`,
            ["--rot" as string]: `${p.rotate}deg`,
          }}
        />
      ))}
    </div>
  );
}
