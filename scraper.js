const puppeteer = require("puppeteer");
const send = require("./sendToHostinger");

async function scrape(plate){

 const browser = await puppeteer.launch({
   headless:true,
   args:["--no-sandbox"]
 });

 const page = await browser.newPage();

 await page.goto("https://example.com");

 const products = [{
   name:"Plaquette frein",
   price:49.90,
   supplier:"Test Supplier"
 }];

 await browser.close();

 await send(products);

 return products;
}

module.exports = scrape;