import React from "react";
import {
  AbsoluteFill,
  Series,
  Sequence,
  Audio,
  Img,
  staticFile,
  spring,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ===================== Timing (authored in 30fps units, rendered at 60fps) =====================
// Scene logic uses a virtual 30fps frame (useCurrentFrame()/K); only the Series
// boundaries and audio cue offsets are scaled by K to real 60fps frames.
const FPS = 30; // 30fps = universally smooth playback (120fps stutters on many players)
const K = FPS / 30; // 1
// Order: attention opener -> agenda hook -> 3 problems -> "Presenting"
// reveal -> solutions -> outro. Tightened holds (no content removed).
const OPEN = 74;
const AGENDA = 90;
const P1 = 88;
const P2 = 88;
const P3 = 88;
const REVEAL = 62;
const S1 = 56;
const S2 = 56;
const PHONE = 128;
const S3 = 56;
const BRAND = 38;
const OUT = 60;
const BASE_TOTAL =
  OPEN + AGENDA + P1 + P2 + P3 + REVEAL + S1 + S2 + PHONE + S3 + BRAND + OUT;
export const GOD_DURATION = BASE_TOTAL * K;
export const GOD_FPS = FPS;

const T_OPEN = 0;
const T_AGENDA = T_OPEN + OPEN;
const T_P1 = T_AGENDA + AGENDA;
const T_P2 = T_P1 + P1;
const T_P3 = T_P2 + P2;
const T_REVEAL = T_P3 + P3;
const T_S1 = T_REVEAL + REVEAL;
const T_S2 = T_S1 + S1;
const T_PHONE = T_S2 + S2;
const T_S3 = T_PHONE + PHONE;
const T_BRAND = T_S3 + S3;
const T_OUT = T_BRAND + BRAND;

// ===================== Palette =====================
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

// ===================== Eye-candy: floating compliance motifs (on-theme) =====================
// Soft, slowly drifting SOC 2 / audit glyphs — shields, checks, locks, docs,
// gauges — that belong in a compliance product video.
const motifPath = (kind: string) => {
  switch (kind) {
    case "shield":
      return (<><path d="M32 11l19 7v13c0 13-9 19-19 23-10-4-19-10-19-23V18z" /><path d="M24 32l6 6 11-12" /></>);
    case "check":
      return (<><circle cx="32" cy="32" r="21" /><path d="M22 33l7 7 13-15" /></>);
    case "lock":
      return (<><rect x="13" y="27" width="38" height="27" rx="6" /><path d="M21 27v-6a11 11 0 0 1 22 0v6" /><path d="M32 38v6" /></>);
    case "doc":
      return (<><path d="M18 10h20l8 8v36H18z" /><path d="M38 10v8h8" /><path d="M24 30h16M24 38h16M24 46h10" /></>);
    case "gauge":
      return (<><path d="M12 45a20 20 0 0 1 40 0" /><path d="M32 45l11-13" /><circle cx="32" cy="45" r="3" fill="currentColor" stroke="none" /></>);
    default:
      return null;
  }
};
const MOTIFS = [
  { kind: "shield", x: 96, y: 305, size: 150, color: ROYAL, depth: 0.5, spd: 0.42, rot: 7 },
  { kind: "check", x: 880, y: 250, size: 120, color: "#10b981", depth: 0.7, spd: 0.5, rot: -9 },
  { kind: "lock", x: 905, y: 1130, size: 138, color: VIOLET, depth: 0.45, spd: 0.46, rot: 6 },
  { kind: "doc", x: 100, y: 1175, size: 130, color: SKY, depth: 0.8, spd: 0.6, rot: -8 },
  { kind: "check", x: 838, y: 1640, size: 116, color: ROYAL, depth: 0.55, spd: 0.5, rot: 10 },
  { kind: "shield", x: 160, y: 775, size: 110, color: "#10b981", depth: 0.6, spd: 0.52, rot: -6 },
  { kind: "gauge", x: 905, y: 770, size: 120, color: ROYAL, depth: 0.5, spd: 0.45, rot: 8 },
  { kind: "doc", x: 858, y: 1185, size: 108, color: ROYAL, depth: 0.66, spd: 0.55, rot: 5 },
  { kind: "lock", x: 170, y: 1560, size: 118, color: SKY, depth: 0.5, spd: 0.43, rot: -7 },
  { kind: "check", x: 150, y: 470, size: 100, color: VIOLET, depth: 0.74, spd: 0.6, rot: 8 },
];

const ComplianceMotifs: React.FC = () => {
  const frame = useCurrentFrame() / K;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {MOTIFS.map((m, i) => {
        const dy = Math.sin(frame * 0.012 * m.spd + i) * 34 * m.depth;
        const dx = Math.cos(frame * 0.010 * m.spd + i * 1.7) * 26 * m.depth;
        const rot = Math.sin(frame * 0.01 * m.spd + i) * m.rot;
        const op = (0.16 - m.depth * 0.06);
        return (
          <div key={i} style={{ position: "absolute", left: m.x + dx, top: m.y + dy, color: m.color, opacity: op, transform: `rotate(${rot}deg)`, filter: `blur(${0.6 + m.depth * 1.4}px)` }}>
            <svg width={m.size} height={m.size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              {motifPath(m.kind)}
            </svg>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const Background: React.FC = () => {
  const frame = useCurrentFrame() / K;
  const sway = Math.sin(frame * 0.012) * 60;
  const orb = (x: number, y: number, size: number, color: string) => (
    <div style={{ position: "absolute", left: x, top: y, width: size, height: size, borderRadius: "50%", background: `radial-gradient(circle at 50% 50%, ${color}, rgba(255,255,255,0) 70%)`, filter: "blur(80px)" }} />
  );
  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff", overflow: "hidden" }}>
      {orb(-260 - sway, 120, 760, "rgba(96,165,250,0.34)")}
      {orb(W - 500 + sway, 120, 760, "rgba(139,92,246,0.24)")}
      {orb(-200 + sway, H - 760, 720, "rgba(125,211,252,0.30)")}
      {orb(W - 520 - sway, H - 760, 720, "rgba(37,99,235,0.18)")}
      {orb(W / 2 - 380, H / 2 - 380, 760, "rgba(191,219,254,0.30)")}
      <ComplianceMotifs />
      <AbsoluteFill style={{ background: "radial-gradient(78% 62% at 50% 47%, rgba(255,255,255,0.60), rgba(255,255,255,0) 90%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 20%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.45) 100%)" }} />
    </AbsoluteFill>
  );
};

// ===================== 3D scene wrapper — premium depth fly-through + light streak =====================
const Scene3D: React.FC<{ dur: number; axis?: "x" | "y"; children: React.ReactNode }> = ({ dur, axis = "x", children }) => {
  const f = useCurrentFrame() / K;
  const ein = spring({ frame: f, fps: 30, config: { damping: 15, mass: 0.9, stiffness: 130 } });
  const eout = interpolate(f, [dur - 12, dur - 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });

  // enter: rush in from depth with overshoot; exit: push back + fade
  const scale = interpolate(ein, [0, 1], [0.82, 1]) + eout * 0.16;
  const tz = interpolate(ein, [0, 1], [-700, 0]) + eout * 440;
  const rotV = (1 - ein) * 22 + eout * -20;
  const r = axis === "y" ? `rotateY(${rotV}deg)` : `rotateX(${rotV}deg)`;
  const blur = (1 - Math.min(1, ein)) * 6 + eout * 6;
  const op = Math.min(ein, 1 - eout);

  // light streak sweep on entrance
  const streak = interpolate(f, [0, 13], [-35, 135], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const streakOp = interpolate(f, [0, 4, 13], [0, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ perspective: 1700 }}>
      <AbsoluteFill style={{ transform: `translateZ(${tz}px) ${r} scale(${scale})`, opacity: op, filter: blur > 0.4 ? `blur(${blur}px)` : "none", transformStyle: "preserve-3d" }}>
        {children}
      </AbsoluteFill>
      <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden", opacity: streakOp, mixBlendMode: "screen" }}>
        <div style={{ position: "absolute", top: "-20%", left: `${streak}%`, width: "32%", height: "140%", background: "linear-gradient(105deg, transparent, rgba(96,165,250,0.55), rgba(255,255,255,0.7), transparent)", filter: "blur(16px)", transform: "skewX(-14deg)" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ===================== Icons =====================
const sxp = { fill: "none", stroke: "currentColor", strokeWidth: 4.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
type IP = { s?: number };
const Svg: React.FC<{ children: React.ReactNode; s?: number }> = ({ children, s = 60 }) => (
  <svg width={s} height={s} viewBox="0 0 64 64" {...sxp}>{children}</svg>
);
const IScatter: React.FC<IP> = ({ s }) => (<Svg s={s}><rect x="9" y="11" width="17" height="17" rx="4" /><rect x="37" y="20" width="17" height="17" rx="4" /><rect x="17" y="37" width="17" height="17" rx="4" /></Svg>);
const IRefresh: React.FC<IP> = ({ s }) => (<Svg s={s}><path d="M50 24a20 20 0 1 0 3 16" /><path d="M52 12v13H39" /></Svg>);
const IXCircle: React.FC<IP> = ({ s }) => (<Svg s={s}><circle cx="32" cy="32" r="21" /><path d="M25 25l14 14M39 25L25 39" /></Svg>);
const IHourglass: React.FC<IP> = ({ s }) => (<Svg s={s}><path d="M19 13h26M19 51h26" /><path d="M22 13c0 12 20 13 20 19s-20 7-20 19" /><path d="M42 13c0 12-20 13-20 19s20 7 20 19" /></Svg>);
const IChartDown: React.FC<IP> = ({ s }) => (<Svg s={s}><path d="M12 14v38h40" /><path d="M20 26l10 10 8-7 12 12" /><path d="M50 41v10H40" /></Svg>);
const IAlert: React.FC<IP> = ({ s }) => (<Svg s={s}><path d="M32 12L54 50H10z" /><path d="M32 28v9" /><circle cx="32" cy="44" r="1.6" fill="currentColor" stroke="none" /></Svg>);
const IClock: React.FC<IP> = ({ s }) => (<Svg s={s}><circle cx="32" cy="32" r="21" /><path d="M32 19v13l9 6" /></Svg>);
const IShieldQ: React.FC<IP> = ({ s }) => (<Svg s={s}><path d="M32 11l19 7v13c0 13-9 19-19 23-10-4-19-10-19-23V18z" /><path d="M27 28a5 5 0 1 1 7 5c-1.5 1-2 2-2 4" /><circle cx="32" cy="43" r="1.6" fill="currentColor" stroke="none" /></Svg>);
const IMoneyDown: React.FC<IP> = ({ s }) => (<Svg s={s}><circle cx="32" cy="32" r="21" /><path d="M32 21v22M27 26h8a4 4 0 0 1 0 8h-6a4 4 0 0 0 0 8h9" /></Svg>);
const ILock: React.FC<IP> = ({ s }) => (<Svg s={s}><rect x="13" y="27" width="38" height="27" rx="6" /><path d="M21 27v-6a11 11 0 0 1 22 0v6" /><path d="M32 38v6" /></Svg>);
const IGauge: React.FC<IP> = ({ s }) => (<Svg s={s}><path d="M12 45a20 20 0 0 1 40 0" /><path d="M32 45l11-13" /><circle cx="32" cy="45" r="3.2" fill="currentColor" stroke="none" /></Svg>);
const IShieldCheck: React.FC<IP> = ({ s }) => (<Svg s={s}><path d="M32 11l19 7v13c0 13-9 19-19 23-10-4-19-10-19-23V18z" /><path d="M24 32l6 6 11-12" /></Svg>);

// ===================== Shared bits =====================
const Pill: React.FC<{ text: string; color: string }> = ({ text, color }) => (
  <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color, background: `${color}14`, border: `2px solid ${color}33`, padding: "11px 28px", borderRadius: 999 }}>
    {text}
  </div>
);

const BigIcon: React.FC<{ color: string; tint: string; children: React.ReactNode; scale: number; frame: number }> = ({ color, tint, children, scale, frame }) => {
  const pulse = 0.85 + 0.15 * Math.sin(frame * 0.12);
  const float = Math.sin(frame * 0.08) * 6;
  return (
    <div style={{ position: "relative", transform: `translateY(${float}px) scale(${scale})` }}>
      {/* glow */}
      <div style={{ position: "absolute", inset: -40, borderRadius: "50%", background: `radial-gradient(circle, ${color}44, ${color}00 68%)`, filter: "blur(14px)", opacity: pulse }} />
      <div style={{ position: "relative", width: 140, height: 140, borderRadius: 36, background: tint, color, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 26px 60px ${color}33, inset 0 1px 0 rgba(255,255,255,0.8)` }}>
        {children}
      </div>
    </div>
  );
};

// ===================== Logo (extruded 3D) =====================
const Logo: React.FC<{ size: number }> = ({ size }) => {
  // fake extrusion: stacked layers behind the face
  const layers = 7;
  return (
    <div style={{ position: "relative", width: size, height: size, transformStyle: "preserve-3d" }}>
      {Array.from({ length: layers }).map((_, i) => (
        <div key={i} style={{ position: "absolute", inset: 0, borderRadius: size * 0.24, background: ROYAL_DK, transform: `translateZ(${-(i + 1) * 6}px)`, opacity: 0.5 }} />
      ))}
      <div style={{ position: "absolute", inset: 0, borderRadius: size * 0.24, background: `linear-gradient(150deg, ${SKY} 0%, ${ROYAL} 48%, ${ROYAL_DK} 100%)`, boxShadow: "0 34px 80px rgba(37,99,235,0.45)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(75% 70% at 30% 22%, rgba(255,255,255,0.45), rgba(255,255,255,0) 55%)" }} />
        <span style={{ fontFamily: FONT, fontWeight: 800, color: "#fff", fontSize: size * 0.32, lineHeight: 1.0, letterSpacing: 2, textAlign: "center", display: "flex", flexDirection: "column" }}>
          <span>AR</span><span>AI</span>
        </span>
      </div>
    </div>
  );
};

// ===================== Scene: Opener — attention hook (SOC 2 audit seal slams in) =====================
const AuditSeal: React.FC<{ scale: number; rot: number }> = ({ scale, rot }) => (
  <div style={{ width: 300, height: 300, position: "relative", transform: `rotate(${rot}deg) scale(${scale})` }}>
    <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `linear-gradient(145deg, ${SKY} 0%, ${ROYAL} 55%, ${ROYAL_DK} 100%)`, boxShadow: "0 28px 70px rgba(37,99,235,0.45)" }} />
    <div style={{ position: "absolute", inset: 14, borderRadius: "50%", border: "3px solid rgba(255,255,255,0.55)" }} />
    {/* notched seal ring */}
    {Array.from({ length: 40 }).map((_, i) => (
      <div key={i} style={{ position: "absolute", left: "50%", top: "50%", width: 4, height: 12, background: "rgba(255,255,255,0.5)", borderRadius: 2, transform: `translate(-50%,-50%) rotate(${i * 9}deg) translateY(-135px)` }} />
    ))}
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: FONT }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 6 }}>AUDIT</div>
      <div style={{ fontSize: 78, fontWeight: 900, letterSpacing: -2, lineHeight: 0.95 }}>SOC&nbsp;2</div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 20, fontWeight: 800, letterSpacing: 3, marginTop: 2 }}>
        <svg width={22} height={22} viewBox="0 0 64 64" fill="none" stroke="#fff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round"><path d="M16 33l11 11 22-26" /></svg>
        READY
      </div>
    </div>
  </div>
);
const SceneOpen: React.FC = () => {
  const frame = useCurrentFrame() / K;
  const fps = 30;
  // stamp slam
  const stamp = spring({ frame, fps, config: { damping: 9, mass: 0.7, stiffness: 140 } });
  const sealScale = interpolate(stamp, [0, 1], [1.7, 1]);
  const sealRot = interpolate(stamp, [0, 1], [-16, -7]);
  const hook = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  const sub = spring({ frame: frame - 24, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40, perspective: 1500, textAlign: "center", padding: "0 70px" }}>
      <div style={{ opacity: Math.min(1, stamp * 1.6) }}>
        <AuditSeal scale={sealScale} rot={sealRot} />
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 78, color: INK, letterSpacing: -2.5, lineHeight: 1.04, opacity: hook, transform: `translateY(${interpolate(hook, [0, 1], [24, 0])}px)`, maxWidth: 900 }}>
        Losing enterprise deals<br />over <span style={{ color: ROYAL }}>SOC 2?</span>
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 500, fontSize: 36, color: SLATE, lineHeight: 1.35, maxWidth: 820, opacity: sub }}>
        Get audit-ready in days — not months.
      </div>
    </AbsoluteFill>
  );
};

// ===================== Scene: Intro — "Presenting AuditReady AI" =====================
const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame() / K;
  const fps = 30;
  const kick = spring({ frame, fps, config: { damping: 200 } });
  const pop = spring({ frame: frame - 12, fps, config: { damping: 11, mass: 0.8 } });
  const spin = interpolate(pop, [0, 1], [-150, 0]);
  const word = spring({ frame: frame - 28, fps, config: { damping: 200 } });
  const tag = spring({ frame: frame - 40, fps, config: { damping: 200 } });
  const sweep = interpolate(frame % 70, [0, 70], [-220, 220]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44, perspective: 1500 }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 30, color: SLATE, letterSpacing: interpolate(kick, [0, 1], [2, 14]), textTransform: "uppercase", opacity: kick, transform: `translateY(${interpolate(kick, [0, 1], [16, 0])}px)` }}>Presenting</div>
      <div style={{ transform: `rotateY(${spin}deg) scale(${interpolate(pop, [0, 1], [0.4, 1])})`, transformStyle: "preserve-3d", position: "relative" }}>
        {/* orbiting ring */}
        <div style={{ position: "absolute", inset: -54, borderRadius: "50%", border: `4px solid ${SKY}55`, transform: `rotateX(72deg) rotateZ(${frame * 3}deg)` }} />
        <div style={{ position: "absolute", inset: -54, borderRadius: "50%", borderTop: `5px solid ${ROYAL}`, borderRight: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: "5px solid transparent", transform: `rotateX(72deg) rotateZ(${frame * 3}deg)` }} />
        <Logo size={300} />
        {/* gloss sweep, clipped to the badge so it reads as a shine (no band) */}
        <div style={{ position: "absolute", inset: 0, borderRadius: 72, overflow: "hidden", pointerEvents: "none" }}>
          <div style={{ position: "absolute", top: 0, left: sweep, width: 90, height: "100%", background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.5), transparent)", filter: "blur(8px)", transform: "skewX(-12deg)" }} />
        </div>
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 88, color: INK, letterSpacing: -2, opacity: word, transform: `translateY(${interpolate(word, [0, 1], [24, 0])}px)` }}>
        AuditReady<span style={{ color: ROYAL }}> AI</span>
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 30, color: SLATE, letterSpacing: 6, textTransform: "uppercase", opacity: tag }}>SOC 2, on autopilot</div>
    </AbsoluteFill>
  );
};

// ===================== Scene: Agenda (what problems, where) =====================
const AGENDA_ITEMS = [
  { n: "01", icon: <IScatter s={40} />, title: "Evidence everywhere", color: ROSE, tint: "#fff1f2" },
  { n: "02", icon: <IHourglass s={40} />, title: "Months of audit prep", color: VIOLET, tint: "#f5f3ff" },
  { n: "03", icon: <IClock s={40} />, title: "Deals stall on review", color: ROYAL, tint: "#eff6ff" },
];
const AgendaScene: React.FC = () => {
  const frame = useCurrentFrame() / K;
  const fps = 30;
  const sp = (delay: number, damping = 200) => spring({ frame: frame - delay, fps, config: { damping } });
  const k = sp(2);
  const h = sp(10);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", padding: "210px 80px 0" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: "100%" }}>
        <div style={{ opacity: k, transform: `translateY(${interpolate(k, [0, 1], [-16, 0])}px)` }}><Pill text="Sound familiar?" color={ROYAL} /></div>
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 70, color: INK, letterSpacing: -2.5, textAlign: "center", lineHeight: 1.06, opacity: h, transform: `translateY(${interpolate(h, [0, 1], [22, 0])}px)`, marginBottom: 20 }}>
          3 things slowing<br />down your <span style={{ color: ROYAL }}>SOC 2</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%", maxWidth: 800 }}>
          {AGENDA_ITEMS.map((it, i) => {
            const p = sp(12 + i * 11, 16);
            return (
              <div key={it.n} style={{ display: "flex", alignItems: "center", gap: 24, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(15,23,42,0.07)", borderRadius: 24, padding: "24px 28px", boxShadow: "0 18px 40px rgba(15,23,42,0.07)", opacity: p, transform: `translateX(${interpolate(p, [0, 1], [i % 2 ? 50 : -50, 0])}px)` }}>
                <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 40, color: `${it.color}`, opacity: 0.4, width: 58 }}>{it.n}</div>
                <div style={{ width: 72, height: 72, borderRadius: 20, flexShrink: 0, background: it.tint, color: it.color, display: "flex", alignItems: "center", justifyContent: "center" }}>{it.icon}</div>
                <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 40, color: INK, letterSpacing: -1 }}>{it.title}</div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ===================== Scene: Problem (with bullets) =====================
type Bullet = { icon: React.ReactNode; title: string; sub: string };
const ProblemScene: React.FC<{ index: string; color: string; tint: string; icon: React.ReactNode; bold: string; bullets: Bullet[] }> = ({ index, color, tint, icon, bold, bullets }) => {
  const frame = useCurrentFrame() / K;
  const fps = 30;
  const sp = (delay: number, damping = 200) => spring({ frame: frame - delay, fps, config: { damping } });
  const head = sp(2);
  const big = sp(8, 14);
  const title = sp(14);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", padding: "250px 70px 0" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26, width: "100%" }}>
        <div style={{ opacity: head, transform: `translateY(${interpolate(head, [0, 1], [-18, 0])}px)` }}><Pill text={index} color={color} /></div>
        <BigIcon color={color} tint={tint} scale={big} frame={frame}>{icon}</BigIcon>
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 72, color: INK, letterSpacing: -2, textAlign: "center", lineHeight: 1.05, opacity: title, transform: `translateY(${interpolate(title, [0, 1], [22, 0])}px)`, maxWidth: 880 }}>{bold}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, opacity: title }}>
          <div style={{ height: 4, width: 70, borderRadius: 9, background: `${color}55` }} />
          <div style={{ width: 8, height: 8, borderRadius: 9, background: color }} />
          <div style={{ height: 4, width: 70, borderRadius: 9, background: `${color}55` }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 820, marginTop: 8 }}>
          {bullets.map((b, i) => {
            const bp = sp(15 + i * 9, 18);
            return (
              <div key={b.title} style={{ display: "flex", alignItems: "center", gap: 22, background: "rgba(255,255,255,0.74)", border: "1px solid rgba(15,23,42,0.07)", borderRadius: 22, padding: "22px 26px", boxShadow: "0 16px 38px rgba(15,23,42,0.07)", backdropFilter: "blur(4px)", opacity: bp, transform: `translateX(${interpolate(bp, [0, 1], [-44, 0])}px)` }}>
                <div style={{ width: 64, height: 64, borderRadius: 18, flexShrink: 0, background: tint, color, display: "flex", alignItems: "center", justifyContent: "center" }}>{b.icon}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 34, color: INK, letterSpacing: -0.5 }}>{b.title}</div>
                  <div style={{ fontFamily: FONT, fontWeight: 500, fontSize: 27, color: SLATE, lineHeight: 1.3 }}>{b.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ===================== Scene: Solution =====================
const SolutionScene: React.FC<{ icon: React.ReactNode; bold: string; detail: string }> = ({ icon, bold, detail }) => {
  const frame = useCurrentFrame() / K;
  const fps = 30;
  const sp = (delay: number, damping = 200) => spring({ frame: frame - delay, fps, config: { damping } });
  const head = sp(2);
  const big = sp(6, 14);
  const title = sp(9);
  const det = sp(15);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", padding: "380px 80px 0" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, textAlign: "center" }}>
        <div style={{ opacity: head }}><Pill text="AuditReady" color={ROYAL} /></div>
        <BigIcon color={ROYAL} tint="#eff6ff" scale={big} frame={frame}>{icon}</BigIcon>
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 86, color: INK, letterSpacing: -2.5, lineHeight: 1.04, opacity: title, transform: `translateY(${interpolate(title, [0, 1], [24, 0])}px)`, maxWidth: 880 }}>{bold}</div>
        <div style={{ fontFamily: FONT, fontWeight: 500, fontSize: 36, color: SLATE, lineHeight: 1.34, maxWidth: 760, opacity: det }}>{detail}</div>
        <div style={{ height: 9, width: interpolate(det, [0, 1], [0, 300]), borderRadius: 999, background: `linear-gradient(90deg, ${ROYAL}, ${SKY})` }} />
      </div>
    </AbsoluteFill>
  );
};

// ===================== Scene: Natural 3D Phone (real UI, app-style swipe) =====================
const PHONE_W = 540;
const PHONE_H = 1120;
const INSET = 18;
const SW = PHONE_W - INSET * 2;
const SH = PHONE_H - INSET * 2;
const DASH_RATIO = 3255 / 1290;
const CTRL_RATIO = 2640 / 1290;

const ScenePhone: React.FC = () => {
  const f = useCurrentFrame() / K;
  const fps = 30;

  // natural entrance: float up, settle with subtle overshoot
  const enter = spring({ frame: f, fps, config: { damping: 14, mass: 1.1, stiffness: 90 } });
  const exit = interpolate(f, [PHONE - 28, PHONE - 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // resting tilt + gentle held-in-hand sway (shallow angles so no 3D aliasing seams)
  const swayY = Math.sin(f * 0.045) * 2.2;
  const swayX = Math.sin(f * 0.035 + 1) * 1.2;
  const tiltY = interpolate(enter, [0, 1], [15, -8]) + swayY + exit * 18;
  const tiltX = interpolate(enter, [0, 1], [7, 4]) + swayX - exit * 5;
  const bob = Math.sin(f * 0.05) * 9;
  const ty = interpolate(enter, [0, 1], [820, 0]) + bob - exit * 360;
  const scale = interpolate(enter, [0, 1], [0.9, 1]) - exit * 0.08;
  const opacity = enter * (1 - exit);

  // fast, natural vertical scroll through the real app (dashboard then controls)
  const Hd = SW * DASH_RATIO;
  const Hc = SW * CTRL_RATIO;
  const TOTAL = Hd + Hc;
  const TOP = 78;
  const BOTTOM = -(TOTAL - SH);
  const MID = -(Hd - SH + 24); // dashboard fully read; top of controls peeking
  // hold on the score, quick flick down the dashboard, brief settle, flick into controls
  const scroll = interpolate(f, [18, 50, 64, PHONE - 20], [TOP, MID, MID, BOTTOM], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const prog = (TOP - scroll) / (TOP - BOTTOM);
  const thumbH = Math.max(70, SH * (SH / TOTAL));
  const thumbTop = prog * (SH - thumbH);

  const head = spring({ frame: f - 6, fps, config: { damping: 200 } });
  const headOp = head * (1 - exit);

  // light gloss sweep across the glass
  const gloss = interpolate(f % 90, [0, 90], [-PHONE_W, PHONE_W * 1.5]);

  return (
    <AbsoluteFill style={{ alignItems: "center", perspective: 2000 }}>
      <div style={{ position: "absolute", top: 122, left: 80, right: 80, textAlign: "center", opacity: headOp, transform: `translateY(${interpolate(head, [0, 1], [24, 0])}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <Pill text="The real platform" color={ROYAL} />
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 64, color: INK, letterSpacing: -2, lineHeight: 1.06 }}>See your score<br /><span style={{ color: ROYAL }}>come to life.</span></div>
      </div>

      <div style={{ position: "absolute", top: 392, transformStyle: "preserve-3d" }}>
        {/* contact shadow */}
        <div style={{ position: "absolute", left: PHONE_W / 2 - 170, top: PHONE_H + 40 + ty * 0.1, width: 360, height: 64, borderRadius: "50%", background: "rgba(37,99,235,0.16)", filter: "blur(42px)", opacity: opacity * (0.7 - Math.abs(bob) * 0.01), transform: `scale(${1 - Math.abs(bob) * 0.01})` }} />

        <div style={{ width: PHONE_W, height: PHONE_H, borderRadius: 72, background: "linear-gradient(155deg, #fdfdff, #e7ecf3)", border: "3px solid #dce3ed", boxShadow: "0 50px 90px rgba(37,99,235,0.14), 0 18px 44px rgba(15,23,42,0.12), inset 0 2px 3px rgba(255,255,255,0.9)", transform: `translateY(${ty}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`, opacity, transformStyle: "flat", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", isolation: "isolate", willChange: "transform", position: "relative" }}>
          {/* camera pill */}
          <div style={{ position: "absolute", top: 28, left: "50%", transform: "translateX(-50%)", width: 130, height: 32, borderRadius: 999, background: "#d7deea", zIndex: 6 }} />
          {/* screen — single tall page, natural vertical scroll */}
          <div style={{ position: "absolute", inset: INSET, borderRadius: 56, overflow: "hidden", background: "#fff" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: SW, transform: `translateY(${scroll}px)` }}>
              <Img src={staticFile("ui/dashboard.png")} style={{ display: "block", width: SW, height: Hd }} />
              <Img src={staticFile("ui/controls.png")} style={{ display: "block", width: SW, height: Hc }} />
            </div>
            {/* clean fade under the notch */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 76, background: "linear-gradient(180deg, #fff 38%, rgba(255,255,255,0) 100%)", pointerEvents: "none" }} />
            {/* scroll indicator */}
            <div style={{ position: "absolute", right: 7, top: thumbTop, width: 5, height: thumbH, borderRadius: 999, background: "rgba(15,23,42,0.16)" }} />
            {/* glass gloss sweep */}
            <div style={{ position: "absolute", top: 0, left: gloss, width: 160, height: "100%", background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.35), transparent)", filter: "blur(8px)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 78%, rgba(255,255,255,0.10) 100%)", pointerEvents: "none" }} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ===================== Scene: Brand =====================
const SceneBrand: React.FC = () => {
  const frame = useCurrentFrame() / K;
  const fps = 30;
  const pop = spring({ frame, fps, config: { damping: 12 } });
  const line = spring({ frame: frame - 14, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 42, padding: "0 80px", textAlign: "center", perspective: 1500 }}>
      <div style={{ transformStyle: "preserve-3d", transform: `rotateY(${interpolate(pop, [0, 1], [90, 0])}deg) scale(${interpolate(pop, [0, 1], [0.6, 1])})` }}><Logo size={200} /></div>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 96, color: INK, letterSpacing: -3, lineHeight: 1.04, opacity: line, transform: `translateY(${interpolate(line, [0, 1], [30, 0])}px)` }}>Walk in <span style={{ color: ROYAL }}>audit&#8209;ready.</span></div>
    </AbsoluteFill>
  );
};

// ===================== Scene: Outro =====================
const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame() / K;
  const fps = 30;
  const p = spring({ frame, fps, config: { damping: 13 } });
  const underline = spring({ frame: frame - 12, fps, config: { damping: 200 }, durationInFrames: 30 });
  const shimmer = interpolate(frame % 80, [0, 80], [-300, 300]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", perspective: 1300 }}>
      <div style={{ opacity: p, transform: `rotateX(${interpolate(p, [0, 1], [55, 0])}deg) scale(${interpolate(p, [0, 1], [0.85, 1])})`, display: "flex", flexDirection: "column", alignItems: "center", gap: 22, position: "relative" }}>
        <div style={{ position: "relative", fontFamily: FONT, fontWeight: 800, fontSize: 106, letterSpacing: -3, background: `linear-gradient(120deg, ${ROYAL_DK}, ${ROYAL} 55%, ${SKY})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
          auditready.space
          <div style={{ position: "absolute", top: 0, left: shimmer, width: 120, height: "100%", background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.7), transparent)", filter: "blur(10px)" }} />
        </div>
        <div style={{ height: 11, width: interpolate(underline, [0, 1], [0, 580]), borderRadius: 999, background: `linear-gradient(90deg, ${ROYAL}, ${SKY})` }} />
      </div>
    </AbsoluteFill>
  );
};

// ===================== Progress bar =====================
const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const w = interpolate(frame, [0, durationInFrames - 1], [0, 100], { extrapolateRight: "clamp" });
  return <div style={{ position: "absolute", bottom: 0, left: 0, height: 6, width: `${w}%`, background: `linear-gradient(90deg, ${ROYAL}, ${SKY})` }} />;
};

// ===================== Grain (dithers gradients, kills banding) =====================
const NOISE_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")";
const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const x = (frame * 13) % 200;
  const y = (frame * 7) % 200;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: NOISE_URI,
        backgroundRepeat: "repeat",
        backgroundPosition: `${x}px ${y}px`,
        opacity: 0.045,
        mixBlendMode: "overlay",
        pointerEvents: "none",
      }}
    />
  );
};

// ===================== Audio cues =====================
const cue = (src: string, from: number, volume = 0.5) => ({ src, from, volume });
const CUES = [
  // attention opener — seal stamp slam
  cue("audio/impact.wav", T_OPEN + 2, 0.85),
  cue("audio/pop.wav", T_OPEN + 14, 0.45),
  cue("audio/pop.wav", T_OPEN + 30, 0.4),
  // hook (agenda)
  cue("audio/whoosh.wav", T_AGENDA - 4, 0.45),
  cue("audio/pop.wav", T_AGENDA + 8, 0.42),
  cue("audio/tick.wav", T_AGENDA + 22, 0.32),
  cue("audio/tick.wav", T_AGENDA + 38, 0.32),
  cue("audio/tick.wav", T_AGENDA + 54, 0.32),
  // problems
  cue("audio/whoosh.wav", T_P1 - 4, 0.5),
  cue("audio/pop.wav", T_P1 + 8, 0.42),
  cue("audio/tick.wav", T_P1 + 24, 0.3),
  cue("audio/tick.wav", T_P1 + 36, 0.3),
  cue("audio/tick.wav", T_P1 + 48, 0.3),
  cue("audio/whoosh.wav", T_P2 - 4, 0.5),
  cue("audio/pop.wav", T_P2 + 8, 0.42),
  cue("audio/tick.wav", T_P2 + 24, 0.3),
  cue("audio/tick.wav", T_P2 + 36, 0.3),
  cue("audio/tick.wav", T_P2 + 48, 0.3),
  cue("audio/whoosh.wav", T_P3 - 4, 0.5),
  cue("audio/pop.wav", T_P3 + 8, 0.42),
  cue("audio/tick.wav", T_P3 + 24, 0.3),
  cue("audio/tick.wav", T_P3 + 36, 0.3),
  cue("audio/tick.wav", T_P3 + 48, 0.3),
  // THE REVEAL — the turn, give it weight
  cue("audio/riser.wav", T_REVEAL - 24, 0.5),
  cue("audio/impact.wav", T_REVEAL + 2, 0.85),
  cue("audio/sparkle.wav", T_REVEAL + 16, 0.6),
  // solutions
  cue("audio/whoosh.wav", T_S1 - 4, 0.5),
  cue("audio/pop.wav", T_S1 + 6, 0.45),
  cue("audio/whoosh.wav", T_S2 - 4, 0.5),
  cue("audio/pop.wav", T_S2 + 6, 0.45),
  // phone
  cue("audio/riser.wav", T_PHONE - 26, 0.5),
  cue("audio/whoosh.wav", T_PHONE - 2, 0.5),
  cue("audio/ding.wav", T_PHONE + 16, 0.55),
  cue("audio/whoosh.wav", T_PHONE + 18, 0.3),
  cue("audio/whoosh.wav", T_PHONE + 64, 0.3),
  // solution 3
  cue("audio/whoosh.wav", T_S3 - 4, 0.5),
  cue("audio/pop.wav", T_S3 + 6, 0.45),
  // brand + outro
  cue("audio/whoosh.wav", T_BRAND - 4, 0.5),
  cue("audio/sparkle.wav", T_BRAND + 6, 0.4),
  cue("audio/whoosh.wav", T_OUT - 4, 0.5),
  cue("audio/impact.wav", T_OUT + 2, 0.6),
  cue("audio/ding.wav", T_OUT + 12, 0.45),
];

// ===================== Root =====================
export const VerticalGod: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />

      <Series>
        {/* BRANDED CONTEXT OPENER — what this is */}
        <Series.Sequence durationInFrames={OPEN * K}><Scene3D dur={OPEN} axis="y"><SceneOpen /></Scene3D></Series.Sequence>
        {/* HOOK + the 3 problems */}
        <Series.Sequence durationInFrames={AGENDA * K}><Scene3D dur={AGENDA} axis="x"><AgendaScene /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={P1 * K}>
          <Scene3D dur={P1} axis="x">
            <ProblemScene index="Problem 01" color={ROSE} tint="#fff1f2" icon={<IScatter />} bold="Evidence lives everywhere." bullets={[
              { icon: <IScatter s={34} />, title: "Scattered files", sub: "Screenshots & spreadsheets across 12+ tools" },
              { icon: <IRefresh s={34} />, title: "Endless re-work", sub: "Re-collected by hand before every audit" },
              { icon: <IXCircle s={34} />, title: "No source of truth", sub: "Nobody knows what's actually covered" },
            ]} />
          </Scene3D>
        </Series.Sequence>
        <Series.Sequence durationInFrames={P2 * K}>
          <Scene3D dur={P2} axis="x">
            <ProblemScene index="Problem 02" color={VIOLET} tint="#f5f3ff" icon={<IHourglass />} bold="Audit prep eats months." bullets={[
              { icon: <IHourglass s={34} />, title: "Manual mapping", sub: "Hand-mapping every SOC 2 control" },
              { icon: <IChartDown s={34} />, title: "Stalled progress", sub: "Weeks lost before real work starts" },
              { icon: <IAlert s={34} />, title: "Team burnout", sub: "Engineers pulled off the roadmap" },
            ]} />
          </Scene3D>
        </Series.Sequence>
        <Series.Sequence durationInFrames={P3 * K}>
          <Scene3D dur={P3} axis="x">
            <ProblemScene index="Problem 03" color={ROSE} tint="#fff1f2" icon={<IClock />} bold="Deals stall on security review." bullets={[
              { icon: <IClock s={34} />, title: "Slow buyers", sub: "Enterprise security reviews drag for weeks" },
              { icon: <IShieldQ s={34} />, title: "Trust gap", sub: "No proof you're actually compliant" },
              { icon: <IMoneyDown s={34} />, title: "Lost revenue", sub: "Deals slip to next quarter" },
            ]} />
          </Scene3D>
        </Series.Sequence>

        {/* THE REVEAL — Presenting AuditReady AI */}
        <Series.Sequence durationInFrames={REVEAL * K}><Scene3D dur={REVEAL} axis="y"><SceneIntro /></Scene3D></Series.Sequence>

        {/* SOLUTIONS + live product */}
        <Series.Sequence durationInFrames={S1 * K}><Scene3D dur={S1} axis="y"><SolutionScene icon={<ILock />} bold="One Evidence Locker." detail="Auto-collected from GitHub, Google & Slack — always current." /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={S2 * K}><Scene3D dur={S2} axis="y"><SolutionScene icon={<IGauge />} bold="A score in 10 minutes." detail="Connect your stack and see exactly where you stand." /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={PHONE * K}><ScenePhone /></Series.Sequence>
        <Series.Sequence durationInFrames={S3 * K}><Scene3D dur={S3} axis="y"><SolutionScene icon={<IShieldCheck />} bold="Share a live Trust Page." detail="Send real-time proof and close enterprise deals faster." /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={BRAND * K}><Scene3D dur={BRAND} axis="y"><SceneBrand /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={OUT * K}><SceneOutro /></Series.Sequence>
      </Series>

      <Grain />
      <ProgressBar />
    </AbsoluteFill>
  );
};
