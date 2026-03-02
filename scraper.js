const sendToHostinger = require("./sendToHostinger");

async function scrape(plate) {
  const parts = [
    { name: "Plaquette frein", price: 49.9, supplier: "Test Supplier", url: "https://example.com" },
  ];

  // ✅ IMPORTANT: on envoie bien plate + parts
  await sendToHostinger({ plate, parts });

  return parts;
}

module.exports = scrape;