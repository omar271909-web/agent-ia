const express = require("express");
require("dotenv").config();

const scrape = require("./scraper");

const app = express();
app.use(express.json());

app.get("/run", async (req, res) => {
  try {
    const plate = req.query.plate || "";
    const result = await scrape(plate);
    res.json({ ok: true, plate, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Agent IA listening on", PORT));