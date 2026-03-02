const sendToHostinger = require("./sendToHostinger");

async function scrape(plate) {
  const parts = [
    {
      name: "TEST_INSERT_OK",
      price: 12.34,
      supplier: "RailwayTest",
      url: "https://example.com"
    }
  ];

  const resp = await sendToHostinger({ plate, parts });
  console.log("Saved to Hostinger:", resp);

  return parts;
}

module.exports = scrape;