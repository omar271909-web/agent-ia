const axios = require("axios");

async function sendToHostinger({ plate, parts }) {
  const url = process.env.HOSTINGER_URL;
  const token = process.env.HOSTINGER_TOKEN;

  try {
    const response = await axios.post(
      url,
      { plate, parts },
      {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": token,
        },
        // Important pour lire la réponse même si c'est une erreur
        validateStatus: () => true,
      }
    );

    console.log("Hostinger status:", response.status);
    console.log("Hostinger data:", response.data);

    // si Hostinger renvoie une erreur, on la remonte clairement
    if (response.status >= 400) {
      throw new Error(`Hostinger error ${response.status}: ${JSON.stringify(response.data)}`);
    }

    return response.data;
  } catch (e) {
    console.error("sendToHostinger failed:", e?.message || e);
    throw e;
  }
}

module.exports = sendToHostinger;