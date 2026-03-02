const express = require("express");
require("dotenv").config();

const scrape = require("./scraper");

const app = express();
app.use(express.json());

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.json({ ok: true, status: "healthy" }));

// ✅ Mode PRO: répond tout de suite (évite le timeout Railway)
app.get("/run", (req, res) => {
  const plate = (req.query.plate || "").toString().trim();
  if (!plate) return res.status(400).json({ ok: false, error: "Missing plate (?plate=...)" });

  // fire-and-forget
  setImmediate(async () => {
    try {
      console.log("ASYNC RUN plate =", plate);
      await scrape(plate);
      console.log("ASYNC RUN done =", plate);
    } catch (e) {
      console.error("ASYNC RUN error:", e);
    }
  });

  return res.json({ ok: true, started: true, plate });
});

// (Optionnel) Mode debug: attend la fin (risque timeout si long)
app.get("/run-sync", async (req, res) => {
  try {
    const plate = (req.query.plate || "").toString().trim();
    if (!plate) return res.status(400).json({ ok: false, error: "Missing plate (?plate=...)" });

    console.log("SYNC RUN plate =", plate);
    const result = await scrape(plate);
    res.json({ ok: true, plate, result });
  } catch (e) {
    console.error("SYNC RUN error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Agent IA listening on", PORT));