import { chromium } from "playwright-core";
import http from "http";
import { readFile, stat } from "fs/promises";
import { extname, join, normalize } from "path";

const ROOT = normalize(join(process.cwd(), "..", "public"));
const PORT = 8799;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/" || p === "") p = "/index.html";
    const fp = join(ROOT, p);
    const s = await stat(fp).catch(() => null);
    if (!s || !s.isFile()) {
      res.writeHead(404).end("nf");
      return;
    }
    const buf = await readFile(fp);
    res.writeHead(200, { "content-type": TYPES[extname(fp)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(500).end("err");
  }
});
await new Promise((r) => server.listen(PORT, r));

const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC });

// tall mobile viewport, hi-dpi for crisp capture
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "networkidle" });

// Seed a realistic logged-in session + dashboard, bypassing the backend.
await page.evaluate(() => {
  // fake user
  window.ST = window.ST || {};
  ST.user = { name: "Jordan Mills", email: "jordan@northwind.io", type: "github", username: "northwind", githubToken: null, avatar: "" };
  ST.mode = "sandbox";
  try { sessionStorage.setItem("ar_user", JSON.stringify(ST.user)); } catch {}
  if (typeof updateHeader === "function") updateHeader();

  // show dashboard page
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("on"));
  document.getElementById("pg-dashboard").classList.add("on");
  document.querySelectorAll(".hn").forEach((h) => h.classList.remove("active"));
  const hn = document.getElementById("hn-dashboard");
  if (hn) hn.classList.add("active");

  // hide onboarding, seed score panel
  const ob = document.getElementById("onboardingCard");
  if (ob) ob.style.display = "none";
  const up = document.getElementById("upsellCard");
  if (up) up.style.display = "none";

  if (typeof renderScorePanel === "function") {
    renderScorePanel({ score: 92, color: "#16a34a", label: "Audit Ready", verified: 58, applicable: 63, tier: "AUDIT_READY" });
  }
  // score sub already set; ensure ring number colored
  const sn = document.getElementById("scoreNum"); if (sn) { sn.textContent = "92%"; sn.style.color = "#16a34a"; }
  const sl = document.getElementById("scoreLabel"); if (sl) { sl.textContent = "Audit Ready"; sl.style.color = "#16a34a"; }

  if (typeof renderCategoryBars === "function") {
    renderCategoryBars({
      CC1: { name: "Control Environment", score: 100, color: "#16a34a" },
      CC2: { name: "Communication & Information", score: 95, color: "#16a34a" },
      CC5: { name: "Control Activities", score: 90, color: "#16a34a" },
      CC6: { name: "Logical & Physical Access", score: 88, color: "#22c55e" },
      CC7: { name: "System Operations", score: 84, color: "#22c55e" },
      CC8: { name: "Change Management", score: 78, color: "#f59e0b" },
    });
  }
  if (typeof renderTopGaps === "function") {
    renderTopGaps([
      { id: "CC7.2", title: "Security incident monitoring & alerting" },
      { id: "CC8.1", title: "Change management approval workflow" },
    ]);
  }
});
await page.waitForTimeout(400);

// scope the screenshot to the dashboard page element for a clean, full-bleed app shot
const dash = await page.$("#pg-dashboard");
await dash.screenshot({ path: "assets/ui-dashboard.png" });

// Now capture the Control Checklist page with seeded controls
await page.evaluate(() => {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("on"));
  document.getElementById("pg-controls").classList.add("on");
  const mk = (id, title, status) => ({ id, title, status, evidenceItems: status === "EVIDENCE_UPLOADED" || status === "CONNECTED_AUTO" ? [1] : [] });
  const grouped = {
    CC6: [
      mk("CC6.1", "Logical access controls restrict access", "CONNECTED_AUTO"),
      mk("CC6.2", "User registration & de-registration", "EVIDENCE_UPLOADED"),
      mk("CC6.3", "Role-based access enforced", "EVIDENCE_UPLOADED"),
      mk("CC6.6", "Encryption in transit & at rest", "CONNECTED_AUTO"),
      mk("CC6.7", "Data transmission protections", "IN_PROGRESS"),
    ],
    CC7: [
      mk("CC7.1", "Vulnerability detection & monitoring", "CONNECTED_AUTO"),
      mk("CC7.2", "Security incident monitoring", "NOT_STARTED"),
      mk("CC7.3", "Incident response evaluation", "IN_PROGRESS"),
    ],
    CC8: [
      mk("CC8.1", "Change management approvals", "IN_PROGRESS"),
      mk("CC8.6", "Change documentation retained", "EVIDENCE_UPLOADED"),
    ],
  };
  if (typeof renderControls === "function") renderControls(grouped);
});
await page.waitForTimeout(300);
const ctrl = await page.$("#pg-controls");
await ctrl.screenshot({ path: "assets/ui-controls.png" });

await browser.close();
server.close();
console.log("captured dashboard + controls");
