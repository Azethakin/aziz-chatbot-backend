import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const apiKeys = [
  { name: 'API_KEY_1', value: process.env.API_KEY_1 },
  { name: 'API_KEY_2', value: process.env.API_KEY_2 },
  { name: 'API_KEY_3', value: process.env.API_KEY_3 },
  { name: 'API_KEY_4', value: process.env.API_KEY_4 }
];


app.post('/chat', async (req, res) => {
  const { model, messages } = req.body;

  for (let keyObj of apiKeys) {
    const { name, value } = keyObj;
    try {
      console.log("API key utilisée :", name);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${value}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
      });

      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      } else {
        const errorText = await response.text();
        console.warn(`❌ Erreur avec la clé : ${name} => ${errorText}`);
      }
    } catch (err) {
      console.error(`💥 Échec avec la clé ${name} :`, err.message);
    }
  }


  res.status(500).json({ error: "❌ Toutes les clés ont échoué ou atteint leur limite." });
});

app.listen(10000, () => {
  console.log("✅ Serveur lancé sur le port 10000");
});
