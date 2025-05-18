const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Récupère les clés dans les variables d’environnement
const apiKeys = [
  process.env.API_KEY_1,
  process.env.API_KEY_2,
  process.env.API_KEY_3,
  process.env.API_KEY_4
];

app.post('/chat', async (req, res) => {
  const { model, messages } = req.body;

  let response;
  let success = false;

  for (let key of apiKeys) {
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7
        })
      });

      if (response.ok) {
        const data = await response.json();
        return res.json(data); // Succès, on arrête ici
      } else {
        const errorText = await response.text();
        console.warn(`Erreur avec clé : ${key.slice(0, 15)}... => ${errorText}`);
      }
    } catch (err) {
      console.error(`Échec avec la clé ${key.slice(0, 10)}...`, err.message);
    }
  }

  // Si aucune clé n’a fonctionné
  res.status(500).json({ error: "❌ Toutes les clés ont échoué ou atteint leur limite." });
});

app.listen(10000, () => {
  console.log("✅ Serveur lancé sur le port 10000");
});
