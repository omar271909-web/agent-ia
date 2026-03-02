const express = require("express");
require("dotenv").config();

const scrape = require("./scraper");

const app = express();

app.get("/run", async (req,res)=>{

 const plate = req.query.plate;

 const result = await scrape(plate);

 res.json(result);
});

app.listen(3000,()=>{
 console.log("Agent IA lancé");
});