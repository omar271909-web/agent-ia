const express = require("express");
require("dotenv").config();

const scrape = require("./scraper");

const app = express();
app.use(express.json());

app.get("/run", async (req, res) => {
  try {
    const plate = (req.query.plate || "").toString().trim();

    if (!plate) {
      return res.status(400).json({ ok: false, error: "Missing plate in query (?plate=...)" });
    }

    console.log("RUN plate =", plate);

    const result = await scrape(plate);
    res.json({ ok: true, plate, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});