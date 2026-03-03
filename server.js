const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// ✅ CORS + preflight
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ✅ HEALTH toujours dispo
app.get("/health", (req, res) => res.json({ ok: true, status: "up" }));
app.get("/", (req, res) => res.send("OK"));

// --- chargement modules sans casser le boot ---
let atelio = null;
let atelioSess = null;
let loadError = null;

try {
  atelio = require("./scrapers/atelio");
} catch (e) {
  loadError = "Failed to load ./scrapers/atelio: " + String(e?.stack || e);
  console.error(loadError);
}

try {
  atelioSess = require("./scrapers/atelioSession");
} catch (e) {
  loadError = (loadError ? loadError + "\n" : "") + "Failed to load ./scrapers/atelioSession: " + String(e?.stack || e);
  console.error("Failed to load ./scrapers/atelioSession:", e);
}

// ✅ Debug endpoint pour voir si ça a chargé
app.get("/debug/modules", (req, res) => {
  res.json({
    ok: true,
    atelioLoaded: !!atelio,
    atelioSessLoaded: !!atelioSess,
    loadError: loadError || null,
    atelioExports: atelio ? Object.keys(atelio) : [],
  });
});

// Helper : vérifie modules chargés
function requireModules(res) {
  if (!atelio || !atelioSess) {
    res.status(500).json({
      ok: false,
      error: "Modules not loaded. Check /debug/modules",
    });
    return false;
  }
  return true;
}

/**
 * STEP 1 : START
 */
app.get("/atelio/start", async (req, res) => {
  try {
    if (!requireModules(res)) return;

    const plate = String(req.query.plate || "").trim();
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });

    const sessionId = await atelioSess.createSession();
    const { page } = atelioSess.getSession(sessionId);

    await atelio.loginIfNeeded(page);
    if (process.env.SUP_URL_MENU) await atelio.gotoStable(page, process.env.SUP_URL_MENU);

    await atelio.enterPlate(page, plate);
    const models = await atelio.extractModels(page);

    res.json({ ok: true, plate, sessionId, models });
  } catch (e) {
    console.error("START error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * STEP 2 : PARTS
 */
app.get("/atelio/parts2", async (req, res) => {
  try {
    if (!requireModules(res)) return;

    const sessionId = String(req.query.sessionId || "").trim();
    const modelToken = String(req.query.modelToken || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "Missing sessionId" });
    if (!modelToken) return res.status(400).json({ ok: false, error: "Missing modelToken" });

    const { page } = atelioSess.getSession(sessionId);

    await atelio.pickModel(page, modelToken);
    const parts = await atelio.extractParts(page);

    res.json({ ok: true, sessionId, modelToken, parts });
  } catch (e) {
    console.error("PARTS error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * STEP 3 : PIECES
 */
app.get("/atelio/pieces2", async (req, res) => {
  try {
    if (!requireModules(res)) return;

    const sessionId = String(req.query.sessionId || "").trim();
    const partToken = String(req.query.partToken || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "Missing sessionId" });
    if (!partToken) return res.status(400).json({ ok: false, error: "Missing partToken" });

    const { page } = atelioSess.getSession(sessionId);

    await atelio.openPlanche(page, partToken);
    await atelio.ensurePiecesTab(page);

    const { error, pieces } = await atelio.extractPiecesFromBestTable(page);
    if (error) return res.status(500).json({ ok: false, error });

    res.json({ ok: true, sessionId, partToken, pieces });
  } catch (e) {
    console.error("PIECES error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * CLOSE
 */
app.get("/atelio/close", async (req, res) => {
  try {
    if (!requireModules(res)) return;

    const sessionId = String(req.query.sessionId || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "Missing sessionId" });
    await atelioSess.closeSession(sessionId);
    res.json({ ok: true });
  } catch (e) {
    console.error("CLOSE error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Agent IA listening on", PORT));