const express = require("express");
require("dotenv").config();
const atelio = require("./scrapers/atelio");

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/version", (req, res) => res.send("atelio-api-v3"));

app.get("/atelio/models", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });
    const models = await atelio.getModelsByPlate(plate);
    res.json({ ok: true, plate, models });
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
    const parts = await atelio.getPartsByPlateAndModel(plate, modelToken);
    res.json({ ok: true, plate, modelToken, parts });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/atelio/pieces", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    const modelToken = String(req.query.modelToken || "").trim();
    const partToken = String(req.query.partToken || "").trim(); // planche:XXXX
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });
    if (!modelToken) return res.status(400).json({ ok: false, error: "Missing modelToken" });
    if (!partToken) return res.status(400).json({ ok: false, error: "Missing partToken" });

    const pieces = await atelio.getPiecesByPlateModelPlanche(plate, modelToken, partToken);
    res.json({ ok: true, plate, modelToken, partToken, pieces });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/atelio/ref", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    const modelToken = String(req.query.modelToken || "").trim();
    const partToken = String(req.query.partToken || "").trim();   // planche:XXXX
    const pieceToken = String(req.query.pieceToken || "").trim(); // row:N ou href:...
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });
    if (!modelToken) return res.status(400).json({ ok: false, error: "Missing modelToken" });
    if (!partToken) return res.status(400).json({ ok: false, error: "Missing partToken" });
    if (!pieceToken) return res.status(400).json({ ok: false, error: "Missing pieceToken" });

    const ref = await atelio.getRefByPlateModelPlanchePiece(plate, modelToken, partToken, pieceToken);
    res.json({ ok: true, plate, modelToken, partToken, pieceToken, ref });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Agent IA listening on", PORT));