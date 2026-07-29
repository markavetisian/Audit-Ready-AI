import React from "react";
import {
  AbsoluteFill,
  Series,
  spring,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from "remotion";

// ---- Timing ----
const S1 = 70; // logo intro
const S2 = 95; // problem
const S3 = 95; // solution / 10 min
const S4 = 130; // features
const S5 = 100; // CTA
export const PROMO_DURATION = S1 + S2 + S3 + S4 + S5;

// ---- Brand ----
const NAVY = "#0b1120";
const NAVY_2 = "#0f172a";
const BLUE = "#3b82f6";
const BLUE_HI = "#60a5fa";
const BLUE_LO = "#1d4ed8";
const SLATE = "#94a3b8";
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, PROMO_DURATION], [0, 1]);
  return (
    <AbsoluteFill style={{ backgroundColor: NAVY }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at ${20 + drift * 12}% ${
            15 + drift * 10
          }%, rgba(37,99,235,0.30), rgba(11,17,32,0) 55%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(90% 80% at ${85 - drift * 10}% 90%, rgba(29,78,216,0.22), rgba(11,17,32,0) 60%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Logo: React.FC<{ size: number }> = ({ size }) => {
  const r = size * 0.22;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: `linear-gradient(135deg, ${BLUE_HI} 0%, ${BLUE} 42%, ${BLUE_LO} 100%)`,
        boxShadow: "0 30px 80px rgba(37,99,235,0.45)",
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
            "radial-gradient(75% 75% at 28% 22%, rgba(255,255,255,0.35), rgba(255,255,255,0) 55%)",
        }}
      />
      <span
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          color: "#fff",
          fontSize: size * 0.34,
          lineHeight: 0.95,
          letterSpacing: 1,
          textShadow: "0 2px 8px rgba(11,42,107,0.5)",
        }}
      >
        AR
        <br />
        AI
      </span>
    </div>
  );
};

const useEnter = (delay = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return {
    opacity: p,
    transform: `translateY(${interpolate(p, [0, 1], [28, 0])}px)`,
  };
};

// ---- Scene 1: Logo intro ----
const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.8 } });
  const wordmark = useEnter(18);
  const tag = useEnter(30);
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", gap: 36 }}
    >
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})` }}>
        <Logo size={210} />
      </div>
      <div style={{ textAlign: "center", ...wordmark }}>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 78,
            color: "#fff",
            letterSpacing: -2,
          }}
        >
          AuditReady<span style={{ color: BLUE_HI }}> AI</span>
        </div>
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 500,
          fontSize: 30,
          color: SLATE,
          letterSpacing: 4,
          textTransform: "uppercase",
          ...tag,
        }}
      >
        SOC 2 Compliance, Automated
      </div>
    </AbsoluteFill>
  );
};

// ---- Scene 2: Problem ----
const SceneProblem: React.FC = () => {
  const a = useEnter(4);
  const b = useEnter(16);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: 120,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 600,
          fontSize: 34,
          color: BLUE_HI,
          letterSpacing: 2,
          textTransform: "uppercase",
          marginBottom: 28,
          ...a,
        }}
      >
        The old way
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 86,
          color: "#fff",
          lineHeight: 1.05,
          letterSpacing: -2,
          maxWidth: 1400,
          ...b,
        }}
      >
        Audit season shouldn&rsquo;t mean
        <br />
        <span style={{ color: SLATE }}>months of screenshots & chaos.</span>
      </div>
    </AbsoluteFill>
  );
};

// ---- Scene 3: Solution / counter ----
const Counter: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 10, fps, config: { damping: 200 }, durationInFrames: 45 });
  const val = Math.round(interpolate(p, [0, 1], [0, 10]));
  return (
    <span style={{ color: BLUE_HI, fontVariantNumeric: "tabular-nums" }}>
      {val}
    </span>
  );
};

const SceneSolution: React.FC = () => {
  const a = useEnter(2);
  const b = useEnter(20);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: 120,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 600,
          fontSize: 34,
          color: BLUE_HI,
          letterSpacing: 2,
          textTransform: "uppercase",
          marginBottom: 24,
          ...a,
        }}
      >
        The AuditReady way
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 130,
          color: "#fff",
          letterSpacing: -4,
          lineHeight: 1,
          ...b,
        }}
      >
        Your SOC 2 score in
        <br />
        under <Counter /> minutes.
      </div>
    </AbsoluteFill>
  );
};

// ---- Scene 4: Features ----
const FEATURES: { title: string; desc: string; icon: string }[] = [
  { title: "Control Checklist", desc: "Every SOC 2 control, tracked", icon: "✓" },
  { title: "Evidence Locker", desc: "Auto-collected, audit-ready", icon: "🔒" },
  { title: "Connected Tools", desc: "GitHub, Google, Slack & more", icon: "⚡" },
  { title: "Trust Page", desc: "Share readiness with buyers", icon: "★" },
];

const FeatureCard: React.FC<{ i: number; f: (typeof FEATURES)[number] }> = ({
  i,
  f,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - 8 - i * 8,
    fps,
    config: { damping: 18, mass: 0.7 },
  });
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px) scale(${interpolate(
          p,
          [0, 1],
          [0.92, 1]
        )})`,
        background:
          "linear-gradient(160deg, rgba(30,41,59,0.85), rgba(15,23,42,0.85))",
        border: "1px solid rgba(96,165,250,0.25)",
        borderRadius: 24,
        padding: "40px 38px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
      }}
    >
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 20,
          background: `linear-gradient(135deg, ${BLUE} 0%, ${BLUE_LO} 100%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 40,
          marginBottom: 26,
          boxShadow: "0 12px 30px rgba(37,99,235,0.4)",
        }}
      >
        {f.icon}
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 38,
          color: "#fff",
          letterSpacing: -1,
          marginBottom: 10,
        }}
      >
        {f.title}
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 400, fontSize: 26, color: SLATE }}>
        {f.desc}
      </div>
    </div>
  );
};

const SceneFeatures: React.FC = () => {
  const head = useEnter(0);
  return (
    <AbsoluteFill style={{ padding: "90px 130px", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 60,
          color: "#fff",
          letterSpacing: -1.5,
          marginBottom: 50,
          ...head,
        }}
      >
        From scattered evidence to{" "}
        <span style={{ color: BLUE_HI }}>one source of truth</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 30,
        }}
      >
        {FEATURES.map((f, i) => (
          <FeatureCard key={f.title} i={i} f={f} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---- Scene 5: CTA ----
const SceneCTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 13 } });
  const sub = useEnter(16);
  const btn = useEnter(26);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 30,
      }}
    >
      <div
        style={{ transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])})`, opacity: pop }}
      >
        <Logo size={110} />
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 96,
          color: "#fff",
          letterSpacing: -3,
          lineHeight: 1.02,
          transform: `scale(${interpolate(pop, [0, 1], [0.9, 1])})`,
        }}
      >
        Close enterprise deals.
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 500,
          fontSize: 38,
          color: SLATE,
          ...sub,
        }}
      >
        Walk into every audit ready.
      </div>
      <div
        style={{
          marginTop: 20,
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 34,
          color: "#fff",
          padding: "22px 56px",
          borderRadius: 999,
          background: `linear-gradient(135deg, ${BLUE} 0%, ${BLUE_LO} 100%)`,
          boxShadow: "0 20px 50px rgba(37,99,235,0.5)",
          letterSpacing: 0.5,
          ...btn,
        }}
      >
        auditready.ai
      </div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />
      <Series>
        <Series.Sequence durationInFrames={S1}>
          <SceneIntro />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S2}>
          <SceneProblem />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S3}>
          <SceneSolution />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S4}>
          <SceneFeatures />
        </Series.Sequence>
        <Series.Sequence durationInFrames={S5}>
          <SceneCTA />
        </Series.Sequence>
      </Series>
      {/* persistent watermark */}
      <Sequence>
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div
            style={{
              position: "absolute",
              bottom: 44,
              right: 60,
              fontFamily: FONT,
              fontWeight: 600,
              fontSize: 24,
              color: "rgba(148,163,184,0.55)",
              letterSpacing: 1,
            }}
          >
            AuditReady AI
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
