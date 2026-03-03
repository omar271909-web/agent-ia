const express = require("express");
require("dotenv").config();

const atelio = require("./scrapers/atelio");
const atelioSess = require("./scrapers/atelioSession");

const app = express();
app.use(express.json());

// ✅ CORS complet + preflight
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/version", (req, res) => res.send("atelio-session-api-v1"));

// DEBUG utile
console.log("Atelio exports:", Object.keys(atelio));

/**
 * STEP 1 : START
 */
app.get("/atelio/start", async (req, res) => {
  try {
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
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * STEP 2 : PARTS
 */
app.get("/atelio/parts2", async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId || "").trim();
    const modelToken = String(req.query.modelToken || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "Missing sessionId" });
    if (!modelToken) return res.status(400).json({ ok: false, error: "Missing modelToken" });

    const { page } = atelioSess.getSession(sessionId);

    await atelio.pickModel(page, modelToken);
    const parts = await atelio.extractParts(page);

    res.json({ ok: true, sessionId, modelToken, parts });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * STEP 3 : PIECES
 */
app.get("/atelio/pieces2", async (req, res) => {
  try {
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
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * CLOSE
 */
app.get("/atelio/close", async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId || "").trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: "Missing sessionId" });
    await atelioSess.closeSession(sessionId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Agent IA listening on", PORT));