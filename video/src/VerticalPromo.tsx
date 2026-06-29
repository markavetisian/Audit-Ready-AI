import React from "react";
import {
  AbsoluteFill,
  Series,
  Sequence,
  spring,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ---- Timing (30fps) ----
const S_LOGO = 55;
const S_PAIR = 80;
const S_BRAND = 45;
const S_OUT = 75;
export const VPROMO_DURATION = S_LOGO + S_PAIR * 3 + S_BRAND + S_OUT;

// ---- Palette (bright / white-dominant) ----
const INK = "#0f172a"; // primary text (navy)
const SLATE = "#64748b"; // secondary text
const ROYAL = "#2563eb";
const ROYAL_DK = "#1d4ed8";
const SKY = "#60a5fa";
const CORAL = "#f43f5e"; // problem accent (bright, not dark)
const EMERALD = "#10b981"; // solution accent
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const W = 1080;
const H = 1920;

// ---- Moving navy squares grid on white ----
const GridBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const cell = 108;
  const offset = (frame * 0.7) % cell;
  const cols = Math.ceil(W / cell) + 2;
  const rows = Math.ceil(H / cell) + 2;
  const squares: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cell - offset;
      const y = r * cell - offset;
      const wave = Math.sin((c + r) * 0.7 - frame * 0.11);
      const lit = wave > 0.78;
      squares.push(
        <div
          key={`${r}-${c}`}
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: cell - 2,
            height: cell - 2,
            border: "1px solid rgba(30,41,59,0.06)",
            background: lit
              ? `rgba(37,99,235,${(wave - 0.78) * 0.5})`
              : "transparent",
            borderRadius: 4,
          }}
        />
      );
    }
  }
  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(70% 50% at 50% 12%, rgba(96,165,250,0.12), rgba(255,255,255,0) 70%)",
        }}
      />
      <AbsoluteFill style={{ overflow: "hidden" }}>{squares}</AbsoluteFill>
      {/* drifting outlined accent squares */}
      {[0, 1, 2].map((i) => {
        const t = frame * 0.4 + i * 140;
        const size = 220 + i * 90;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: (i % 2 === 0 ? -60 : W - size + 60),
              top: ((t % (H + size)) - size),
              width: size,
              height: size,
              border: "2px solid rgba(37,99,235,0.10)",
              borderRadius: 28,
              transform: `rotate(${interpolate(
                Math.sin(frame * 0.02 + i),
                [-1, 1],
                [-8, 8]
              )}deg)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ---- Logo: AR stacked perfectly above AI ----
const Logo: React.FC<{ size: number }> = ({ size }) => {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        background: `linear-gradient(150deg, ${SKY} 0%, ${ROYAL} 48%, ${ROYAL_DK} 100%)`,
        boxShadow: "0 24px 60px rgba(37,99,235,0.35)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(75% 70% at 30% 22%, rgba(255,255,255,0.40), rgba(255,255,255,0) 55%)",
        }}
      />
      <span
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          color: "#ffffff",
          fontSize: size * 0.32,
          lineHeight: 1.0,
          letterSpacing: 2,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <span>AR</span>
        <span>AI</span>
      </span>
    </div>
  );
};

const useSpringIn = (delay = 0, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
};

// ---- Scene 1: Logo intro ----
const SceneLogo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.8 } });
  const word = useSpringIn(16);
  const tag = useSpringIn(28);
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", gap: 44 }}
    >
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.5, 1])})` }}>
        <Logo size={300} />
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 84,
          color: INK,
          letterSpacing: -2,
          opacity: word,
          transform: `translateY(${interpolate(word, [0, 1], [24, 0])}px)`,
        }}
      >
        AuditReady<span style={{ color: ROYAL }}> AI</span>
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 600,
          fontSize: 30,
          color: SLATE,
          letterSpacing: 5,
          textTransform: "uppercase",
          opacity: tag,
        }}
      >
        SOC 2, on autopilot
      </div>
    </AbsoluteFill>
  );
};

// ---- Problem → Solution pair ----
const Pill: React.FC<{ text: string; color: string; opacity: number }> = ({
  text,
  color,
  opacity,
}) => (
  <div
    style={{
      opacity,
      alignSelf: "flex-start",
      fontFamily: FONT,
      fontWeight: 800,
      fontSize: 28,
      letterSpacing: 3,
      textTransform: "uppercase",
      color: "#fff",
      background: color,
      padding: "12px 28px",
      borderRadius: 999,
      boxShadow: `0 12px 28px ${color}55`,
    }}
  >
    {text}
  </div>
);

const Mark: React.FC<{ kind: "x" | "check"; color: string; scale: number }> = ({
  kind,
  color,
  scale,
}) => (
  <div
    style={{
      width: 96,
      height: 96,
      borderRadius: 24,
      background: color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `0 16px 36px ${color}55`,
      transform: `scale(${scale})`,
      color: "#fff",
      fontSize: 56,
      fontWeight: 800,
      fontFamily: FONT,
    }}
  >
    {kind === "x" ? "✕" : "✓"}
  </div>
);

const ProblemSolution: React.FC<{
  index: number;
  problem: string;
  solution: string;
}> = ({ index, problem, solution }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  // accent sweep wipe at scene start
  const sweep = interpolate(f, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // problem in/out
  const pIn = spring({ frame: f - 2, fps, config: { damping: 18, mass: 0.7 } });
  const pOut = interpolate(f, [30, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pOpacity = pIn * (1 - pOut);
  const pY = (1 - pIn) * 44 - pOut * 50;

  // solution in
  const sIn = spring({ frame: f - 40, fps, config: { damping: 18, mass: 0.7 } });
  const sY = (1 - sIn) * 50;

  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 80px" }}>
      {/* sweep panel reveal */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(135deg, ${ROYAL} 0%, ${ROYAL_DK} 100%)`,
          transform: `translateX(${interpolate(sweep, [0, 1], [0, 110])}%)`,
        }}
      />

      {/* index marker */}
      <div
        style={{
          position: "absolute",
          top: 360,
          left: 80,
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: 4,
          color: SLATE,
          opacity: pIn,
        }}
      >
        0{index} / 03
      </div>

      {/* PROBLEM */}
      <div
        style={{
          position: "absolute",
          top: 620,
          left: 80,
          right: 80,
          opacity: pOpacity,
          transform: `translateY(${pY}px)`,
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <Mark kind="x" color={CORAL} scale={pIn} />
          <Pill text="The problem" color={CORAL} opacity={pIn} />
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 78,
            color: INK,
            lineHeight: 1.08,
            letterSpacing: -2,
          }}
        >
          {problem}
        </div>
      </div>

      {/* SOLUTION */}
      <div
        style={{
          position: "absolute",
          top: 620,
          left: 80,
          right: 80,
          opacity: sIn,
          transform: `translateY(${sY}px)`,
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <Mark kind="check" color={ROYAL} scale={sIn} />
          <Pill text="AuditReady" color={ROYAL} opacity={sIn} />
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 84,
            color: INK,
            lineHeight: 1.06,
            letterSpacing: -2,
          }}
        >
          {solution}
        </div>
        <div
          style={{
            height: 8,
            width: interpolate(sIn, [0, 1], [0, 280]),
            borderRadius: 999,
            background: `linear-gradient(90deg, ${ROYAL}, ${SKY})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ---- Brand beat ----
const SceneBrand: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 13 } });
  const line = useSpringIn(14);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 40,
        padding: "0 80px",
        textAlign: "center",
      }}
    >
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})` }}>
        <Logo size={180} />
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 92,
          color: INK,
          letterSpacing: -3,
          lineHeight: 1.04,
          opacity: line,
          transform: `translateY(${interpolate(line, [0, 1], [30, 0])}px)`,
        }}
      >
        Walk in <span style={{ color: ROYAL }}>audit&#8209;ready.</span>
      </div>
    </AbsoluteFill>
  );
};

// ---- Outro: only the link ----
const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 14 } });
  const underline = spring({
    frame: frame - 12,
    fps,
    config: { damping: 200 },
    durationInFrames: 30,
  });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          opacity: p,
          transform: `scale(${interpolate(p, [0, 1], [0.85, 1])})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 104,
            letterSpacing: -3,
            background: `linear-gradient(120deg, ${ROYAL_DK}, ${ROYAL} 55%, ${SKY})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          auditready.space
        </div>
        <div
          style={{
            height: 10,
            width: interpolate(underline, [0, 1], [0, 560]),
            borderRadius: 999,
            background: `linear-gradient(90deg, ${ROYAL}, ${SKY})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const VerticalPromo: React.FC = () => {
  return (
    <AbsoluteFill>
      <GridBackground />
      <Series>
        <Series.Sequence durationInFrames={S_LOGO}>
          <SceneLogo />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_PAIR}>
          <ProblemSolution
            index={1}
            problem="Evidence buried across a dozen tools."
            solution="Auto-collected into one Evidence Locker."
          />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_PAIR}>
          <ProblemSolution
            index={2}
            problem="Audit prep drags on for months."
            solution="Your readiness score in under 10 minutes."
          />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_PAIR}>
          <ProblemSolution
            index={3}
            problem="Security reviews stall your biggest deals."
            solution="Share a live Trust Page. Close faster."
          />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_BRAND}>
          <SceneBrand />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_OUT}>
          <SceneOutro />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
