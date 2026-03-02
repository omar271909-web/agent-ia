const express = require("express");
require("dotenv").config();
const atelio = require("./scrapers/atelio");

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/version", (req, res) => res.send("atelio-api-debug-v1"));

app.get("/atelio/models", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });
    res.json({ ok: true, plate, models: await atelio.getModelsByPlate(plate) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/atelio/parts", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    const modelToken = String(req.query.modelToken || "").trim();
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });
    if (!modelToken) return res.status(400).json({ ok: false, error: "Missing modelToken" });
    res.json({ ok: true, plate, modelToken, parts: await atelio.getPartsByPlateAndModel(plate, modelToken) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/atelio/pieces", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    const modelToken = String(req.query.modelToken || "").trim();
    const partToken = String(req.query.partToken || "").trim();
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });
    if (!modelToken) return res.status(400).json({ ok: false, error: "Missing modelToken" });
    if (!partToken) return res.status(400).json({ ok: false, error: "Missing partToken" });

    res.json({ ok: true, plate, modelToken, partToken, pieces: await atelio.getPiecesByPlateModelPlanche(plate, modelToken, partToken) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ✅ NOUVEAU DEBUG
app.get("/atelio/debug-planche", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    const modelToken = String(req.query.modelToken || "").trim();
    const partToken = String(req.query.partToken || "").trim();
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });
    if (!modelToken) return res.status(400).json({ ok: false, error: "Missing modelToken" });
    if (!partToken) return res.status(400).json({ ok: false, error: "Missing partToken" });

    const debug = await atelio.debugPlanche(plate, modelToken, partToken);
    res.json({ ok: true, plate, modelToken, partToken, debug });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Agent IA listening on", PORT));