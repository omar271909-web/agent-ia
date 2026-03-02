const axios = require("axios");

async function sendToHostinger({ plate, parts }) {

  const url = process.env.HOSTINGER_URL;
  const token = process.env.HOSTINGER_TOKEN;

  if (!url) {
    throw new Error("HOSTINGER_URL not defined");
  }

  if (!token) {
    throw new Error("HOSTINGER_TOKEN not defined");
  }

  const response = await axios.post(
    url,
    { plate, parts },
    {
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": token,
      },
    }
  );

  console.log("Hostinger response:", response.data);

  return response.data;
}

module.exports = sendToHostinger;