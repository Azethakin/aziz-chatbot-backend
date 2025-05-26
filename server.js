import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Middleware pour les logs avancés
app.use((req, res, next) => {
  const date = new Date().toISOString();
  console.log(`[${date}] ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

// État dynamique des clés API pour la rotation intelligente
let apiKeysStatus = [
  { name: 'API_KEY_1', value: process.env.API_KEY_1, errors: 0 },
  { name: 'API_KEY_2', value: process.env.API_KEY_2, errors: 0 },
  { name: 'API_KEY_3', value: process.env.API_KEY_3, errors: 0 },
  { name: 'API_KEY_4', value: process.env.API_KEY_4, errors: 0 }
];

app.post('/chat', async (req, res) => {
  const { model, messages } = req.body;

  const supportsStream = ["llama", "mistral"]; // ajoute d'autres si besoin
  const allowStream = supportsStream.some(tag => model.includes(tag));


  console.log("📥 Reçu du frontend :", messages);


  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "Requête invalide : aucun message fourni."
    });
  }

  const timeout = 30000; // 30 secondes

  // Trie les clés par nombre d'erreurs (rotation intelligente)
  apiKeysStatus.sort((a, b) => a.errors - b.errors);

  for (let keyObj of apiKeysStatus) {
    const { name, value } = keyObj;

    try {
      console.log(`🔑 API utilisée : ${name}, modèle : ${model}, IP: ${req.ip}`);

      const response = await Promise.race([
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${value}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            stream: false
          })

        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout atteint')), timeout)
        )
      ]);

      if (response.ok) {
        const data = await response.json();
        keyObj.errors = 0; // réinitialiser les erreurs après succès
        return res.json(data);
      } else {
        const errorText = await response.text();
        console.warn(`❌ Erreur clé ${name} : ${errorText}`);
        keyObj.errors += 1; // incrémente les erreurs
      }

    } catch (err) {
      console.error(`💥 Échec clé ${name} :`, err.message);
      keyObj.errors += 1; // incrémente les erreurs
    }
  }

  res.status(500).json({ error: "❌ Toutes les clés ont échoué ou atteint leur limite." });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
});

