const express = require("express");
require("dotenv").config();

const atelio = require("./scrapers/atelio");

const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

// Pour vérifier que Railway a bien déployé ce code
app.get("/version", (req, res) => res.send("atelio-api-v1"));

app.get("/atelio/models", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });

    const models = await atelio.getModelsByPlate(plate);
    return res.json({ ok: true, plate, models });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/atelio/parts", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    const modelToken = String(req.query.modelToken || "").trim();
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });
    if (!modelToken) return res.status(400).json({ ok: false, error: "Missing modelToken" });

    const parts = await atelio.getPartsByPlateAndModel(plate, modelToken);
    return res.json({ ok: true, plate, modelToken, parts });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/atelio/ref", async (req, res) => {
  try {
    const plate = String(req.query.plate || "").trim();
    const modelToken = String(req.query.modelToken || "").trim();
    const partToken = String(req.query.partToken || "").trim();

    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate" });
    if (!modelToken) return res.status(400).json({ ok: false, error: "Missing modelToken" });
    if (!partToken) return res.status(400).json({ ok: false, error: "Missing partToken" });

    const ref = await atelio.getRefByPlateModelPart(plate, modelToken, partToken);
    return res.json({ ok: true, plate, modelToken, partToken, ref });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Agent IA listening on", PORT));