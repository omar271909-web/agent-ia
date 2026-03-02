const OpenAI = require("openai");

const openai = new OpenAI({
 apiKey:process.env.OPENAI_KEY
});

async function clean(text){

 const res = await openai.chat.completions.create({
   model:"gpt-4o-mini",
   messages:[
     {role:"user",content:`Normalise : ${text}`}
   ]
 });

 return res.choices[0].message.content;
}

module.exports = clean;