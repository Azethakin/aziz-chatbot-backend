import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Middleware logs
app.use((req, res, next) => {
  const date = new Date().toISOString();
  console.log(`[${date}] ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

// Rotation intelligente des clés
let apiKeysStatus = [
  { name: "API_KEY_1", value: process.env.API_KEY_1, errors: 0 },
  { name: "API_KEY_2", value: process.env.API_KEY_2, errors: 0 },
  { name: "API_KEY_3", value: process.env.API_KEY_3, errors: 0 },
  { name: "API_KEY_4", value: process.env.API_KEY_4, errors: 0 },
];

app.post("/chat", async (req, res) => {
  const { model, messages } = req.body;

  console.log("📥 MODEL reçu :", model);
  console.log("📥 Messages reçus :", messages);

  if (!model || typeof model !== "string") {
    return res.status(400).json({ error: "Requête invalide : model manquant ou invalide." });
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Requête invalide : aucun message fourni." });
  }

  const timeoutMs = 30000;

  // Trier par nombre d'erreurs
  apiKeysStatus.sort((a, b) => a.errors - b.errors);

  // On gardera la dernière erreur OpenRouter pour la renvoyer au frontend
  let lastOpenRouterError = null;

  for (const keyObj of apiKeysStatus) {
    const { name, value } = keyObj;

    // ✅ skip si clé vide
    if (!value || typeof value !== "string" || value.trim() === "") {
      console.warn(`⚠️ ${name} est vide/undefined dans les variables d'environnement (Render).`);
      keyObj.errors += 1;
      continue;
    }

    try {
      console.log(`🔑 Tentative avec ${name} | modèle=${model}`);

      const response = await Promise.race([
        fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${value}`,
            "Content-Type": "application/json",

            // ✅ Recommandé par OpenRouter
            "HTTP-Referer": "https://azizmalloul.com",
            "X-Title": "Aziz Chatbot",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
          }),
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout atteint")), timeoutMs)
        ),
      ]);

      // ✅ Succès
      if (response.ok) {
        const data = await response.json();
        keyObj.errors = 0;
        return res.json(data);
      }

      // ❌ Erreur OpenRouter : log détaillé + stockage
      const status = response.status;
      const errorText = await response.text();

      console.warn(`❌ OpenRouter ERROR | status=${status} | key=${name} | body=${errorText}`);

      lastOpenRouterError = { status, key: name, body: errorText };
      keyObj.errors += 1;

    } catch (err) {
      console.error(`💥 Exception avec ${name} :`, err); // log complet
      lastOpenRouterError = { status: 0, key: name, body: String(err?.message || err) };
      keyObj.errors += 1;
    }
  }

  // ✅ Renvoi d'une erreur utile au frontend
  return res.status(502).json({
    error: "❌ Toutes les clés ont échoué (OpenRouter).",
    details: lastOpenRouterError,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
});
