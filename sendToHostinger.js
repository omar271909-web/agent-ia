const axios = require("axios");

async function send(products){

 await axios.post(
   "https://tonsite.com/api/saveParts.php",
   products
 );

}

module.exports = send;