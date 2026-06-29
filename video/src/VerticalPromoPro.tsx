import React from "react";
import {
  AbsoluteFill,
  Series,
  spring,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ---- Timing (30fps) ----
const S_LOGO = 54;
const S_PAIR = 100;
const S_PHONE = 128;
const S_BRAND = 42;
const S_OUT = 70;
// order: Logo, Pair1, Pair2, Phone, Pair3, Brand, Outro
export const VPRO_DURATION =
  S_LOGO + S_PAIR + S_PAIR + S_PHONE + S_PAIR + S_BRAND + S_OUT;

// ---- Palette (bright, premium, white-dominant) ----
const INK = "#0f172a";
const SLATE = "#64748b";
const ROYAL = "#2563eb";
const ROYAL_DK = "#1d4ed8";
const SKY = "#60a5fa";
const ROSE = "#f43f5e";
const VIOLET = "#8b5cf6";
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const W = 1080;
const H = 1920;

// =================================================================
// Background — smooth premium gradient wash, no grid, no dark tones
// =================================================================
const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const orb = (
    phase: number,
    baseX: number,
    baseY: number,
    size: number,
    color: string,
    range = 90
  ) => {
    const dx = Math.sin(frame * 0.011 + phase) * range;
    const dy = Math.cos(frame * 0.009 + phase) * range;
    return (
      <div
        style={{
          position: "absolute",
          left: baseX + dx,
          top: baseY + dy,
          width: size,
          height: size,
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 50%, ${color}, rgba(255,255,255,0) 70%)`,
          filter: "blur(70px)",
        }}
      />
    );
  };
  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff", overflow: "hidden" }}>
      {orb(0, -180, -160, 820, "rgba(96,165,250,0.40)")}
      {orb(2.1, W - 560, 240, 720, "rgba(139,92,246,0.26)")}
      {orb(4.0, -120, H - 720, 760, "rgba(125,211,252,0.34)")}
      {orb(1.3, W - 460, H - 560, 700, "rgba(37,99,235,0.20)")}
      {/* keep the center bright for crisp typography */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(60% 42% at 50% 50%, rgba(255,255,255,0.78), rgba(255,255,255,0) 75%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 22%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.35) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// =================================================================
// Icons — minimalist line set
// =================================================================
const svgBase = {
  width: "58%",
  height: "58%",
  viewBox: "0 0 64 64",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 4.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconScatter: React.FC = () => (
  <svg {...svgBase}>
    <rect x="9" y="11" width="17" height="17" rx="4" />
    <rect x="37" y="20" width="17" height="17" rx="4" />
    <rect x="17" y="37" width="17" height="17" rx="4" />
  </svg>
);
const IconLocker: React.FC = () => (
  <svg {...svgBase}>
    <rect x="13" y="27" width="38" height="27" rx="6" />
    <path d="M21 27v-6a11 11 0 0 1 22 0v6" />
    <path d="M32 38v6" />
  </svg>
);
const IconClock: React.FC = () => (
  <svg {...svgBase}>
    <circle cx="32" cy="32" r="21" />
    <path d="M32 19v13l9 6" />
  </svg>
);
const IconGauge: React.FC = () => (
  <svg {...svgBase}>
    <path d="M12 45a20 20 0 0 1 40 0" />
    <path d="M32 45l11-13" />
    <circle cx="32" cy="45" r="3.2" fill="currentColor" stroke="none" />
  </svg>
);
const IconHourglass: React.FC = () => (
  <svg {...svgBase}>
    <path d="M19 13h26M19 51h26" />
    <path d="M22 13c0 12 20 13 20 19s-20 7-20 19" />
    <path d="M42 13c0 12-20 13-20 19s20 7 20 19" />
  </svg>
);
const IconShield: React.FC = () => (
  <svg {...svgBase}>
    <path d="M32 11l19 7v13c0 13-9 19-19 23-10-4-19-10-19-23V18z" />
    <path d="M24 32l6 6 11-12" />
  </svg>
);

const IconTile: React.FC<{
  color: string;
  tint: string;
  scale: number;
  children: React.ReactNode;
}> = ({ color, tint, scale, children }) => (
  <div
    style={{
      width: 132,
      height: 132,
      borderRadius: 34,
      background: tint,
      color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `0 22px 50px ${color}26`,
      transform: `scale(${scale})`,
    }}
  >
    {children}
  </div>
);

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
      fontSize: 26,
      letterSpacing: 3,
      textTransform: "uppercase",
      color,
      background: `${color}14`,
      border: `2px solid ${color}33`,
      padding: "10px 24px",
      borderRadius: 999,
    }}
  >
    {text}
  </div>
);

// =================================================================
// Logo badge — AR stacked perfectly over AI
// =================================================================
const Logo: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.24,
      background: `linear-gradient(150deg, ${SKY} 0%, ${ROYAL} 48%, ${ROYAL_DK} 100%)`,
      boxShadow: "0 26px 60px rgba(37,99,235,0.34)",
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
        color: "#fff",
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

const useSpringIn = (delay = 0, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
};

// =================================================================
// Scene 1 — Logo intro
// =================================================================
const SceneLogo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.8 } });
  const word = useSpringIn(16);
  const tag = useSpringIn(28);
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", gap: 46 }}
    >
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.5, 1])})` }}>
        <Logo size={300} />
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 86,
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

// =================================================================
// Problem → Solution pair (icon + bold + supporting detail)
// =================================================================
type Side = {
  label: string;
  color: string;
  tint: string;
  icon: React.ReactNode;
  bold: string;
  detail: string;
};

const Block: React.FC<{ side: Side; opacity: number; ty: number }> = ({
  side,
  opacity,
  ty,
}) => (
  <AbsoluteFill
    style={{
      justifyContent: "center",
      padding: "0 84px",
      opacity,
      transform: `translateY(${ty}px)`,
    }}
  >
    <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
      <Pill text={side.label} color={side.color} opacity={1} />
      <IconTile color={side.color} tint={side.tint} scale={1}>
        {side.icon}
      </IconTile>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 80,
          color: INK,
          lineHeight: 1.05,
          letterSpacing: -2,
        }}
      >
        {side.bold}
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 500,
          fontSize: 36,
          color: SLATE,
          lineHeight: 1.32,
          maxWidth: 780,
        }}
      >
        {side.detail}
      </div>
      <div
        style={{
          height: 8,
          width: 220,
          borderRadius: 999,
          marginTop: 6,
          background: `linear-gradient(90deg, ${side.color}, ${side.color}44)`,
        }}
      />
    </div>
  </AbsoluteFill>
);

const ProblemSolution: React.FC<{ problem: Side; solution: Side }> = ({
  problem,
  solution,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pIn = spring({ frame: f - 4, fps, config: { damping: 20, mass: 0.7 } });
  const pOut = interpolate(f, [50, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sIn = spring({ frame: f - 60, fps, config: { damping: 20, mass: 0.7 } });

  return (
    <AbsoluteFill>
      <Block
        side={problem}
        opacity={pIn * (1 - pOut)}
        ty={(1 - pIn) * 46 - pOut * 46}
      />
      <Block side={solution} opacity={sIn} ty={(1 - sIn) * 46} />
    </AbsoluteFill>
  );
};

// =================================================================
// Phone mockup — animates in, demos live app UI, exits cleanly
// =================================================================
const AppScreen: React.FC<{ lf: number }> = ({ lf }) => {
  const { fps } = useVideoConfig();
  // score counts up
  const scoreP = spring({
    frame: lf - 30,
    fps,
    config: { damping: 200 },
    durationInFrames: 46,
  });
  const score = Math.round(interpolate(scoreP, [0, 1], [0, 92]));
  const R = 88;
  const C = 2 * Math.PI * R;
  const dash = C * (1 - (score / 100));

  const controls = [
    "Access control",
    "Encryption at rest",
    "Change management",
    "Incident response",
  ];

  return (
    <div
      style={{
        position: "absolute",
        inset: 16,
        borderRadius: 46,
        background: "#ffffff",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: "30px 30px 26px",
        fontFamily: FONT,
      }}
    >
      {/* status bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: INK,
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 22,
        }}
      >
        <span>9:41</span>
        <span style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 26, height: 12, border: `2px solid ${INK}`, borderRadius: 4, opacity: 0.6 }} />
        </span>
      </div>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 30 }}>
        <Logo size={52} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 800, fontSize: 30, color: INK, letterSpacing: -1 }}>
            AuditReady
          </span>
          <span style={{ fontWeight: 600, fontSize: 19, color: SLATE }}>
            SOC 2 dashboard
          </span>
        </div>
      </div>

      {/* score ring */}
      <div style={{ display: "flex", alignItems: "center", gap: 26, marginBottom: 30 }}>
        <div style={{ position: "relative", width: 210, height: 210 }}>
          <svg width="210" height="210" viewBox="0 0 210 210">
            <defs>
              <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={ROYAL} />
                <stop offset="100%" stopColor={SKY} />
              </linearGradient>
            </defs>
            <circle cx="105" cy="105" r={R} fill="none" stroke="#eef2f7" strokeWidth="18" />
            <circle
              cx="105"
              cy="105"
              r={R}
              fill="none"
              stroke="url(#ring)"
              strokeWidth="18"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={dash}
              transform="rotate(-90 105 105)"
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontWeight: 800, fontSize: 58, color: INK, letterSpacing: -2 }}>
              {score}%
            </span>
            <span style={{ fontWeight: 600, fontSize: 18, color: SLATE }}>ready</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontWeight: 800, fontSize: 28, color: INK, lineHeight: 1.1 }}>
            Audit readiness
          </span>
          <span style={{ fontWeight: 600, fontSize: 20, color: "#16a34a" }}>
            ▲ On track for Type II
          </span>
        </div>
      </div>

      {/* controls list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {controls.map((c, i) => {
          const on = lf > 56 + i * 9;
          return (
            <div
              key={c}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                background: "#f8fafc",
                borderRadius: 18,
                padding: "16px 18px",
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  background: on ? ROYAL : "#e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 22,
                  transition: "none",
                }}
              >
                {on ? "✓" : ""}
              </div>
              <span style={{ fontWeight: 700, fontSize: 25, color: INK }}>{c}</span>
            </div>
          );
        })}
      </div>

      {/* integrations */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 22,
          opacity: lf > 74 ? 1 : 0,
        }}
      >
        {["GitHub", "Google", "Slack"].map((g) => (
          <div
            key={g}
            style={{
              flex: 1,
              textAlign: "center",
              fontWeight: 700,
              fontSize: 21,
              color: ROYAL,
              background: "#eff6ff",
              borderRadius: 14,
              padding: "14px 0",
            }}
          >
            {g}
          </div>
        ))}
      </div>

      {/* CTA button fills the lower screen */}
      <div
        style={{
          marginTop: "auto",
          opacity: lf > 86 ? 1 : 0,
          background: `linear-gradient(135deg, ${ROYAL} 0%, ${ROYAL_DK} 100%)`,
          color: "#fff",
          borderRadius: 20,
          textAlign: "center",
          fontWeight: 800,
          fontSize: 27,
          padding: "24px 0",
          boxShadow: "0 18px 40px rgba(37,99,235,0.32)",
        }}
      >
        Generate audit report →
      </div>
    </div>
  );
};

const ScenePhone: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame: f, fps, config: { damping: 18, mass: 0.9 } });
  const exit = interpolate(f, [S_PHONE - 26, S_PHONE - 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ty = (1 - enter) * 1320 - exit * 1420;
  const rot = (1 - enter) * 6 - exit * 5;
  const scale = 0.92 + enter * 0.08 - exit * 0.05;
  const opacity = enter * (1 - exit);

  const head = useSpringIn(8);
  const headOpacity = head * (1 - exit);

  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      {/* heading anchors the demo */}
      <div
        style={{
          position: "absolute",
          top: 130,
          left: 84,
          right: 84,
          opacity: headOpacity,
          transform: `translateY(${interpolate(head, [0, 1], [26, 0])}px)`,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <Pill text="See it live" color={ROYAL} opacity={1} />
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 70,
            color: INK,
            letterSpacing: -2,
            lineHeight: 1.06,
          }}
        >
          Your readiness score,
          <br />
          <span style={{ color: ROYAL }}>in real time.</span>
        </div>
      </div>

      {/* phone */}
      <div
        style={{
          position: "absolute",
          top: 400,
          width: 520,
          height: 1060,
          borderRadius: 64,
          background: "linear-gradient(160deg, #ffffff, #eef2f7)",
          border: "3px solid #e2e8f0",
          boxShadow: "0 50px 120px rgba(37,99,235,0.22), 0 18px 40px rgba(15,23,42,0.12)",
          transform: `translateY(${ty}px) rotate(${rot}deg) scale(${scale})`,
          opacity,
        }}
      >
        {/* camera pill */}
        <div
          style={{
            position: "absolute",
            top: 26,
            left: "50%",
            transform: "translateX(-50%)",
            width: 120,
            height: 30,
            borderRadius: 999,
            background: "#e2e8f0",
            zIndex: 2,
          }}
        />
        <AppScreen lf={f} />
      </div>
    </AbsoluteFill>
  );
};

// =================================================================
// Brand beat
// =================================================================
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
        gap: 42,
        padding: "0 84px",
        textAlign: "center",
      }}
    >
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})` }}>
        <Logo size={188} />
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 94,
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

// =================================================================
// Outro — only the link
// =================================================================
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
          gap: 20,
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

// continuous bottom progress bar for premium continuity
const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const w = interpolate(frame, [0, durationInFrames - 1], [0, 100], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        height: 6,
        width: `${w}%`,
        background: `linear-gradient(90deg, ${ROYAL}, ${SKY})`,
      }}
    />
  );
};

export const VerticalPromoPro: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />
      <Series>
        <Series.Sequence durationInFrames={S_LOGO}>
          <SceneLogo />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_PAIR}>
          <ProblemSolution
            problem={{
              label: "Problem 01",
              color: ROSE,
              tint: "#fff1f2",
              icon: <IconScatter />,
              bold: "Evidence scattered everywhere.",
              detail: "Screenshots, spreadsheets and Slack threads spread across a dozen tools.",
            }}
            solution={{
              label: "AuditReady",
              color: ROYAL,
              tint: "#eff6ff",
              icon: <IconLocker />,
              bold: "One Evidence Locker.",
              detail: "Auto-collected from GitHub, Google and Slack — always audit-ready.",
            }}
          />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_PAIR}>
          <ProblemSolution
            problem={{
              label: "Problem 02",
              color: VIOLET,
              tint: "#f5f3ff",
              icon: <IconClock />,
              bold: "Months of audit prep.",
              detail: "Manually mapping every control before the real work even begins.",
            }}
            solution={{
              label: "AuditReady",
              color: ROYAL,
              tint: "#eff6ff",
              icon: <IconGauge />,
              bold: "A score in 10 minutes.",
              detail: "Connect your stack and see exactly where you stand, instantly.",
            }}
          />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_PHONE}>
          <ScenePhone />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_PAIR}>
          <ProblemSolution
            problem={{
              label: "Problem 03",
              color: ROSE,
              tint: "#fff1f2",
              icon: <IconHourglass />,
              bold: "Deals stall on security review.",
              detail: "Buyers wait weeks for proof that you're actually compliant.",
            }}
            solution={{
              label: "AuditReady",
              color: ROYAL,
              tint: "#eff6ff",
              icon: <IconShield />,
              bold: "Share a live Trust Page.",
              detail: "Send real-time proof and close enterprise deals faster.",
            }}
          />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_BRAND}>
          <SceneBrand />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S_OUT}>
          <SceneOutro />
        </Series.Sequence>
      </Series>
      <ProgressBar />
    </AbsoluteFill>
  );
};
