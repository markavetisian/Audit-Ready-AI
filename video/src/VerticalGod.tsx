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

// ===================== Timing =====================
const S_INTRO = 56;
const P1 = 92;
const S1 = 58;
const P2 = 92;
const S2 = 58;
const PHONE = 150;
const P3 = 92;
const S3 = 58;
const BRAND = 46;
const OUT = 72;
export const GOD_DURATION =
  S_INTRO + P1 + S1 + P2 + S2 + PHONE + P3 + S3 + BRAND + OUT;

const T_P1 = S_INTRO;
const T_S1 = T_P1 + P1;
const T_P2 = T_S1 + S1;
const T_S2 = T_P2 + P2;
const T_PHONE = T_S2 + S2;
const T_P3 = T_PHONE + PHONE;
const T_S3 = T_P3 + P3;
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

// ===================== Eye-candy: floating 3D shapes + particles =====================
const SHAPES = [
  { type: "ring", x: 150, y: 360, size: 220, color: ROYAL, depth: 0.5, rot: 0.5, spd: 0.5 },
  { type: "cube", x: 860, y: 300, size: 150, color: VIOLET, depth: 0.8, rot: 0.7, spd: 0.7 },
  { type: "pill", x: 920, y: 1080, size: 200, color: SKY, depth: 0.4, rot: -0.4, spd: 0.4 },
  { type: "cube", x: 120, y: 1180, size: 130, color: ROYAL, depth: 0.9, rot: -0.6, spd: 0.6 },
  { type: "ring", x: 820, y: 1620, size: 180, color: VIOLET, depth: 0.55, rot: 0.4, spd: 0.5 },
  { type: "dot", x: 200, y: 1680, size: 90, color: SKY, depth: 0.7, rot: 0, spd: 0.8 },
  { type: "pill", x: 130, y: 760, size: 120, color: VIOLET, depth: 0.6, rot: 0.5, spd: 0.45 },
];

const FloatingShapes: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ perspective: 1400, overflow: "hidden" }}>
      <AbsoluteFill style={{ transformStyle: "preserve-3d" }}>
        {SHAPES.map((s, i) => {
          const drift = Math.sin(frame * 0.013 * s.spd + i) * 40 * s.depth;
          const driftX = Math.cos(frame * 0.011 * s.spd + i * 1.7) * 30 * s.depth;
          const rx = frame * 0.25 * s.rot;
          const ry = frame * 0.35 * s.rot;
          const z = -300 * s.depth;
          const common = {
            position: "absolute" as const,
            left: s.x + driftX,
            top: s.y + drift,
            width: s.size,
            height: s.size,
            transform: `translateZ(${z}px) rotateX(${rx}deg) rotateY(${ry}deg)`,
            filter: `blur(${1.5 + s.depth * 3}px)`,
            opacity: 0.5 - s.depth * 0.22,
          };
          if (s.type === "ring")
            return <div key={i} style={{ ...common, borderRadius: "50%", border: `10px solid ${s.color}`, background: "transparent" }} />;
          if (s.type === "dot")
            return <div key={i} style={{ ...common, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, ${s.color}cc, ${s.color}22 70%)` }} />;
          if (s.type === "pill")
            return <div key={i} style={{ ...common, height: s.size * 0.5, borderRadius: 999, background: `linear-gradient(135deg, ${s.color}aa, ${s.color}33)` }} />;
          // cube (rounded glass square)
          return <div key={i} style={{ ...common, borderRadius: 28, background: `linear-gradient(150deg, ${s.color}aa, ${s.color}22)`, boxShadow: `inset 0 0 30px ${s.color}55` }} />;
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const PARTICLES = Array.from({ length: 40 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1) * W, y: r(2) * H, size: 3 + r(3) * 7, spd: 0.3 + r(4) * 0.9, ph: r(5) * 6.28, blur: r(6) > 0.6 };
});

const Particles: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {PARTICLES.map((p, i) => {
        const y = (p.y - frame * p.spd * 1.4) % (H + 40);
        const yy = y < -20 ? y + H + 40 : y;
        const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(frame * 0.06 * p.spd + p.ph));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x + Math.sin(frame * 0.02 + p.ph) * 18,
              top: yy,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              background: i % 3 === 0 ? SKY : i % 3 === 1 ? VIOLET : ROYAL,
              opacity: tw * 0.4,
              filter: p.blur ? "blur(2px)" : "none",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Background: React.FC = () => {
  const frame = useCurrentFrame();
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
      <FloatingShapes />
      <Particles />
      <AbsoluteFill style={{ background: "radial-gradient(55% 40% at 50% 50%, rgba(255,255,255,0.80), rgba(255,255,255,0) 78%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 20%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.45) 100%)" }} />
    </AbsoluteFill>
  );
};

// ===================== 3D scene wrapper =====================
const Scene3D: React.FC<{ dur: number; axis?: "x" | "y"; children: React.ReactNode }> = ({ dur, axis = "x", children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ein = spring({ frame: f, fps, config: { damping: 18, mass: 0.85 } });
  const eout = interpolate(f, [dur - 13, dur - 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rot = (1 - ein) * -72 + eout * 72;
  const ty = (1 - ein) * 70 - eout * 70;
  const tz = (1 - ein) * -360 - eout * 260;
  const op = ein * (1 - eout);
  const r = axis === "y" ? `rotateY(${rot}deg)` : `rotateX(${rot}deg)`;
  return (
    <AbsoluteFill style={{ perspective: 1700 }}>
      <AbsoluteFill style={{ transform: `translateY(${ty}px) translateZ(${tz}px) ${r}`, opacity: op, transformStyle: "preserve-3d" }}>
        {children}
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

// ===================== Scene: Intro (3D logo + orbiting ring + sweep) =====================
const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 11, mass: 0.8 } });
  const spin = interpolate(pop, [0, 1], [-150, 0]);
  const word = spring({ frame: frame - 18, fps, config: { damping: 200 } });
  const tag = spring({ frame: frame - 30, fps, config: { damping: 200 } });
  const sweep = interpolate(frame % 70, [0, 70], [-220, 220]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 50, perspective: 1500 }}>
      <div style={{ transform: `rotateY(${spin}deg) scale(${interpolate(pop, [0, 1], [0.4, 1])})`, transformStyle: "preserve-3d", position: "relative" }}>
        {/* orbiting ring */}
        <div style={{ position: "absolute", inset: -54, borderRadius: "50%", border: `4px solid ${SKY}55`, transform: `rotateX(72deg) rotateZ(${frame * 3}deg)` }} />
        <div style={{ position: "absolute", inset: -54, borderRadius: "50%", borderTop: `5px solid ${ROYAL}`, borderRight: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: "5px solid transparent", transform: `rotateX(72deg) rotateZ(${frame * 3}deg)` }} />
        <Logo size={300} />
        <div style={{ position: "absolute", top: 0, left: sweep, width: 80, height: "100%", background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.6), transparent)", filter: "blur(6px)", borderRadius: 40 }} />
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 88, color: INK, letterSpacing: -2, opacity: word, transform: `translateY(${interpolate(word, [0, 1], [24, 0])}px)` }}>
        AuditReady<span style={{ color: ROYAL }}> AI</span>
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 30, color: SLATE, letterSpacing: 6, textTransform: "uppercase", opacity: tag }}>SOC 2, on autopilot</div>
    </AbsoluteFill>
  );
};

// ===================== Scene: Problem (with bullets) =====================
type Bullet = { icon: React.ReactNode; title: string; sub: string };
const ProblemScene: React.FC<{ index: string; color: string; tint: string; icon: React.ReactNode; bold: string; bullets: Bullet[] }> = ({ index, color, tint, icon, bold, bullets }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sp = (delay: number, damping = 200) => spring({ frame: frame - delay, fps, config: { damping } });
  const head = sp(2);
  const big = sp(8, 14);
  const title = sp(14);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 70px" }}>
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
            const bp = sp(24 + i * 12, 18);
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
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sp = (delay: number, damping = 200) => spring({ frame: frame - delay, fps, config: { damping } });
  const head = sp(2);
  const big = sp(6, 14);
  const title = sp(12);
  const det = sp(20);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 80px" }}>
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

const ScreenCol: React.FC<{ src: string; ratio: number; scroll: number; dim: number }> = ({ src, ratio, scroll, dim }) => (
  <div style={{ position: "relative", width: SW, height: SH, overflow: "hidden", flexShrink: 0 }}>
    <Img src={staticFile(src)} style={{ position: "absolute", top: 0, left: 0, width: SW, height: SW * ratio, transform: `translateY(${scroll}px)` }} />
    <div style={{ position: "absolute", inset: 0, background: `rgba(15,23,42,${dim})` }} />
  </div>
);

const ScenePhone: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  // natural entrance: float up, settle with subtle overshoot
  const enter = spring({ frame: f, fps, config: { damping: 14, mass: 1.1, stiffness: 90 } });
  const exit = interpolate(f, [PHONE - 28, PHONE - 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // resting tilt + gentle held-in-hand sway (subtle so text stays readable)
  const swayY = Math.sin(f * 0.045) * 2.4;
  const swayX = Math.sin(f * 0.035 + 1) * 1.4;
  const tiltY = interpolate(enter, [0, 1], [34, -9]) + swayY + exit * 26;
  const tiltX = interpolate(enter, [0, 1], [18, 4]) + swayX - exit * 8;
  const bob = Math.sin(f * 0.05) * 10;
  const ty = interpolate(enter, [0, 1], [1280, 0]) + bob - exit * 360;
  const scale = interpolate(enter, [0, 1], [0.82, 1]) - exit * 0.08;
  const opacity = enter * (1 - exit);

  // real app-style horizontal swipe between the two screens
  const swipe = interpolate(f, [74, 96], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const trackX = -SW * swipe;
  const dashScroll = interpolate(f, [10, 84], [78, -Math.max(0, SW * DASH_RATIO - SH)], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ctrlScroll = interpolate(f, [98, PHONE - 12], [52, -Math.max(0, SW * CTRL_RATIO - SH + 52)], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

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
        <div style={{ position: "absolute", left: PHONE_W / 2 - 170, top: PHONE_H + 40 + ty * 0.1, width: 340, height: 60, borderRadius: "50%", background: "rgba(37,99,235,0.28)", filter: "blur(34px)", opacity: opacity * (0.7 - Math.abs(bob) * 0.01), transform: `scale(${1 - Math.abs(bob) * 0.01})` }} />

        <div style={{ width: PHONE_W, height: PHONE_H, borderRadius: 72, background: "linear-gradient(155deg, #fdfdff, #e4eaf2)", border: "3px solid #d7deea", boxShadow: "0 80px 160px rgba(37,99,235,0.30), 0 30px 70px rgba(15,23,42,0.18), inset 0 2px 3px rgba(255,255,255,0.9)", transform: `translateY(${ty}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`, opacity, transformStyle: "preserve-3d", position: "relative" }}>
          {/* camera pill */}
          <div style={{ position: "absolute", top: 28, left: "50%", transform: "translateX(-50%)", width: 130, height: 32, borderRadius: 999, background: "#d7deea", zIndex: 6 }} />
          {/* screen */}
          <div style={{ position: "absolute", inset: INSET, borderRadius: 56, overflow: "hidden", background: "#fff" }}>
            <div style={{ display: "flex", width: SW * 2, height: SH, transform: `translateX(${trackX}px)` }}>
              <ScreenCol src="ui/dashboard.png" ratio={DASH_RATIO} scroll={dashScroll} dim={swipe * 0.12} />
              <ScreenCol src="ui/controls.png" ratio={CTRL_RATIO} scroll={ctrlScroll} dim={(1 - swipe) * 0.12} />
            </div>
            {/* clean fade under the notch */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 76, background: "linear-gradient(180deg, #fff 38%, rgba(255,255,255,0) 100%)", pointerEvents: "none" }} />
            {/* page dots */}
            <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 10 }}>
              <div style={{ width: 9, height: 9, borderRadius: 9, background: swipe < 0.5 ? ROYAL : "#cbd5e1" }} />
              <div style={{ width: 9, height: 9, borderRadius: 9, background: swipe >= 0.5 ? ROYAL : "#cbd5e1" }} />
            </div>
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
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
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
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
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

// ===================== Audio cues =====================
const cue = (src: string, from: number, volume = 0.5) => ({ src, from, volume });
const CUES = [
  cue("audio/impact.wav", 0, 0.85),
  cue("audio/sparkle.wav", 14, 0.6),
  cue("audio/whoosh.wav", T_P1 - 4, 0.5),
  cue("audio/pop.wav", T_P1 + 8, 0.45),
  cue("audio/tick.wav", T_P1 + 24, 0.32),
  cue("audio/tick.wav", T_P1 + 36, 0.32),
  cue("audio/tick.wav", T_P1 + 48, 0.32),
  cue("audio/whoosh.wav", T_S1 - 4, 0.5),
  cue("audio/pop.wav", T_S1 + 6, 0.45),
  cue("audio/whoosh.wav", T_P2 - 4, 0.5),
  cue("audio/pop.wav", T_P2 + 8, 0.45),
  cue("audio/tick.wav", T_P2 + 24, 0.32),
  cue("audio/tick.wav", T_P2 + 36, 0.32),
  cue("audio/tick.wav", T_P2 + 48, 0.32),
  cue("audio/whoosh.wav", T_S2 - 4, 0.5),
  cue("audio/pop.wav", T_S2 + 6, 0.45),
  cue("audio/riser.wav", T_PHONE - 28, 0.55),
  cue("audio/whoosh.wav", T_PHONE - 2, 0.55),
  cue("audio/ding.wav", T_PHONE + 40, 0.55),
  cue("audio/pop.wav", T_PHONE + 78, 0.4),
  cue("audio/whoosh.wav", T_P3 - 4, 0.5),
  cue("audio/pop.wav", T_P3 + 8, 0.45),
  cue("audio/tick.wav", T_P3 + 24, 0.32),
  cue("audio/tick.wav", T_P3 + 36, 0.32),
  cue("audio/tick.wav", T_P3 + 48, 0.32),
  cue("audio/whoosh.wav", T_S3 - 4, 0.5),
  cue("audio/pop.wav", T_S3 + 6, 0.45),
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
      <Audio src={staticFile("audio/music.wav")} volume={0.9} />
      {CUES.map((c, i) => (
        <Sequence key={i} from={c.from}>
          <Audio src={staticFile(c.src)} volume={c.volume} />
        </Sequence>
      ))}

      <Series>
        <Series.Sequence durationInFrames={S_INTRO}><Scene3D dur={S_INTRO} axis="y"><SceneIntro /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={P1}>
          <Scene3D dur={P1} axis="x">
            <ProblemScene index="Problem 01" color={ROSE} tint="#fff1f2" icon={<IScatter />} bold="Evidence lives everywhere." bullets={[
              { icon: <IScatter s={34} />, title: "Scattered files", sub: "Screenshots & spreadsheets across 12+ tools" },
              { icon: <IRefresh s={34} />, title: "Endless re-work", sub: "Re-collected by hand before every audit" },
              { icon: <IXCircle s={34} />, title: "No source of truth", sub: "Nobody knows what's actually covered" },
            ]} />
          </Scene3D>
        </Series.Sequence>
        <Series.Sequence durationInFrames={S1}><Scene3D dur={S1} axis="y"><SolutionScene icon={<ILock />} bold="One Evidence Locker." detail="Auto-collected from GitHub, Google & Slack — always current." /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={P2}>
          <Scene3D dur={P2} axis="x">
            <ProblemScene index="Problem 02" color={VIOLET} tint="#f5f3ff" icon={<IHourglass />} bold="Audit prep eats months." bullets={[
              { icon: <IHourglass s={34} />, title: "Manual mapping", sub: "Hand-mapping every SOC 2 control" },
              { icon: <IChartDown s={34} />, title: "Stalled progress", sub: "Weeks lost before real work starts" },
              { icon: <IAlert s={34} />, title: "Team burnout", sub: "Engineers pulled off the roadmap" },
            ]} />
          </Scene3D>
        </Series.Sequence>
        <Series.Sequence durationInFrames={S2}><Scene3D dur={S2} axis="y"><SolutionScene icon={<IGauge />} bold="A score in 10 minutes." detail="Connect your stack and see exactly where you stand." /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={PHONE}><ScenePhone /></Series.Sequence>
        <Series.Sequence durationInFrames={P3}>
          <Scene3D dur={P3} axis="x">
            <ProblemScene index="Problem 03" color={ROSE} tint="#fff1f2" icon={<IClock />} bold="Deals stall on security review." bullets={[
              { icon: <IClock s={34} />, title: "Slow buyers", sub: "Enterprise security reviews drag for weeks" },
              { icon: <IShieldQ s={34} />, title: "Trust gap", sub: "No proof you're actually compliant" },
              { icon: <IMoneyDown s={34} />, title: "Lost revenue", sub: "Deals slip to next quarter" },
            ]} />
          </Scene3D>
        </Series.Sequence>
        <Series.Sequence durationInFrames={S3}><Scene3D dur={S3} axis="y"><SolutionScene icon={<IShieldCheck />} bold="Share a live Trust Page." detail="Send real-time proof and close enterprise deals faster." /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={BRAND}><Scene3D dur={BRAND} axis="y"><SceneBrand /></Scene3D></Series.Sequence>
        <Series.Sequence durationInFrames={OUT}><SceneOutro /></Series.Sequence>
      </Series>

      <ProgressBar />
    </AbsoluteFill>
  );
};
