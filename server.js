import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  const date = new Date().toISOString();
  console.log(`[${date}] ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

// Petit healthcheck pour Render
app.get("/healthz", (_req, res) => res.json({ ok: true }));

let apiKeysStatus = [
  { name: "API_KEY_1", value: process.env.API_KEY_1, errors: 0 },
  { name: "API_KEY_2", value: process.env.API_KEY_2, errors: 0 },
  { name: "API_KEY_3", value: process.env.API_KEY_3, errors: 0 },
  { name: "API_KEY_4", value: process.env.API_KEY_4, errors: 0 },
].filter(k => !!k.value); // enlève les clés vides

app.post("/chat", async (req, res) => {
  const { model, messages, temperature = 0.7 } = req.body;

  if (!model || typeof model !== "string") {
    return res.status(400).json({ error: "Requête invalide : model manquant." });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Requête invalide : aucun message fourni." });
  }
  if (apiKeysStatus.length === 0) {
    return res.status(500).json({ error: "Aucune clé API disponible sur le serveur (variables d'environnement)." });
  }

  const timeoutMs = 30000;

  // rotation
  apiKeysStatus.sort((a, b) => a.errors - b.errors);

  let lastError = null;

  for (const keyObj of apiKeysStatus) {
    const { name, value } = keyObj;

    try {
      console.log(`🔑 OpenRouter via ${name} | model=${model}`);

      const response = await Promise.race([
        fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${value}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            // Recommandés par OpenRouter (tracking / compat)
            "HTTP-Referer": "https://azizmalloul.com",
            "X-Title": "Aziz Chatbot",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            stream: false,
          }),
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout atteint")), timeoutMs)
        ),
      ]);

      const text = await response.text();

      // tente parse JSON (succès ou erreur)
      let payload = null;
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

      if (response.ok) {
        keyObj.errors = 0;
        return res.json(payload);
      }

      // Logs détaillés
      console.warn(`❌ OpenRouter ${response.status} via ${name} :`, payload);

      // Si modèle invalide (400), inutile de tester les autres clés
      if (response.status === 400) {
        return res.status(400).json({
          error: "Erreur OpenRouter (model/payload). Vérifie l’ID du modèle.",
          details: payload,
        });
      }

      keyObj.errors += 1;
      lastError = { status: response.status, details: payload };

    } catch (err) {
      console.error(`💥 Échec via ${name} :`, err.message);
      keyObj.errors += 1;
      lastError = { status: 500, details: { message: err.message } };
    }
  }

  return res.status(500).json({
    error: "❌ Toutes les clés ont échoué (rate limit / clé invalide / provider down).",
    details: lastError,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Serveur lancé sur le port ${PORT}`));
