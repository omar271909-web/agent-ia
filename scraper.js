const sendToHostinger = require("./sendToHostinger");

async function scrape(plate) {
  plate = (plate || "").toString().trim();
  console.log("SCRAPER plate =", plate);

  const parts = [
    { name: "Plaquette frein", price: 49.9, supplier: "Test Supplier", url: "https://example.com" },
  ];

  await sendToHostinger({ plate, parts });

  return parts;
}

module.exports = scrape;