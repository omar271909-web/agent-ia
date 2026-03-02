const supplier1Scrape = require("./scrapers/supplier1");
const sendToHostinger = require("./sendToHostinger");

async function scrape(plate) {
  const parts = await supplier1Scrape(plate);
  await sendToHostinger({ plate, parts });
  return parts;
}

module.exports = scrape;