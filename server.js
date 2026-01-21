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

// Healthcheck (Render)
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- Gestion clés: erreurs + cooldown ----
let apiKeysStatus = [
  { name: "API_KEY_1", value: process.env.API_KEY_1, errors: 0, disabledUntil: 0 },
  { name: "API_KEY_2", value: process.env.API_KEY_2, errors: 0, disabledUntil: 0 },
  { name: "API_KEY_3", value: process.env.API_KEY_3, errors: 0, disabledUntil: 0 },
  { name: "API_KEY_4", value: process.env.API_KEY_4, errors: 0, disabledUntil: 0 },
].filter(k => !!k.value);

function nowMs() {
  return Date.now();
}

function parseRetryAfterMs(response) {
  // Retry-After peut être en secondes
  const ra = response.headers?.get?.("retry-after");
  if (!ra) return null;
  const seconds = Number(ra);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return null;
}

function pickKeysInOrder(keys) {
  const now = nowMs();
  // On met d'abord les clés non-cooldown, puis par moins d'erreurs
  return [...keys].sort((a, b) => {
    const aReady = a.disabledUntil <= now ? 0 : 1;
    const bReady = b.disabledUntil <= now ? 0 : 1;
    if (aReady !== bReady) return aReady - bReady;
    return a.errors - b.errors;
  });
}

app.post("/chat", async (req, res) => {
  const { model, messages, temperature = 0.7 } = req.body;

  // Validation
  if (!model || typeof model !== "string") {
    return res.status(400).json({ error: "Requête invalide : model manquant." });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Requête invalide : aucun message fourni." });
  }
  if (apiKeysStatus.length === 0) {
    return res.status(500).json({
      error: "Aucune clé API disponible sur le serveur (variables d'environnement)."
    });
  }

  const timeoutMs = 30000;

  const attempts = [];
  const orderedKeys = pickKeysInOrder(apiKeysStatus);
  const now = nowMs();

  // Si toutes les clés sont en cooldown, on renvoie une info claire
  const anyReady = orderedKeys.some(k => k.disabledUntil <= now);
  if (!anyReady) {
    const nextReadyInMs = Math.min(...orderedKeys.map(k => k.disabledUntil)) - now;
    return res.status(429).json({
      error: "⏳ Toutes les clés sont temporairement en cooldown (rate limit).",
      retry_after_ms: Math.max(1000, nextReadyInMs),
      keys: orderedKeys.map(k => ({
        name: k.name,
        disabledUntil: k.disabledUntil,
        errors: k.errors
      })),
    });
  }

  let lastError = null;

  for (const keyObj of orderedKeys) {
    if (keyObj.disabledUntil > nowMs()) {
      attempts.push({ key: keyObj.name, skipped: true, reason: "cooldown" });
      continue;
    }

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

      let payload;
      try { payload = JSON.parse(text); }
      catch { payload = { raw: text }; }

      if (response.ok) {
        keyObj.errors = 0; // succès => reset
        keyObj.disabledUntil = 0;
        attempts.push({ key: name, status: response.status, ok: true });
        return res.json(payload);
      }

      // Erreur OpenRouter
      const status = response.status;
      const msg = payload?.error?.message || payload?.message || "Erreur OpenRouter";
      const code = payload?.error?.code;

      attempts.push({ key: name, status, code, message: msg });

      console.warn(`❌ OpenRouter ${status} via ${name}:`, payload);

      // ---- CAS IMPORTANT: erreurs "modèle / requête" => stop immédiat (ne dépend pas de la clé)
      // 400/404/422 typiquement: mauvais modèle, modèle indispo, payload invalide
      if (status === 400 || status === 404 || status === 422) {
        return res.status(status).json({
          error: "Erreur OpenRouter: modèle/payload invalide ou modèle indisponible.",
          details: payload,
          hint:
            "Vérifie l’ID exact sur OpenRouter. Si tu vois 'No endpoints found', le modèle n’a pas de provider actif.",
          attempts,
        });
      }

      // ---- Rate limit / quota => cooldown + essayer clé suivante
      if (status === 429) {
        const raMs = parseRetryAfterMs(response) ?? 60_000; // par défaut 60s
        keyObj.errors += 2;
        keyObj.disabledUntil = nowMs() + raMs;
        lastError = { status, details: payload };
        continue;
      }

      // ---- Clé invalide / interdite => pénalité forte + désactivation longue
      if (status === 401 || status === 403) {
        keyObj.errors += 5;
        keyObj.disabledUntil = nowMs() + 6 * 60 * 60 * 1000; // 6h
        lastError = { status, details: payload };
        continue;
      }

      // ---- Erreurs provider (5xx) ou autres => petite pénalité + essayer autre clé
      if (status >= 500) {
        keyObj.errors += 1;
        lastError = { status, details: payload };
        continue;
      }

      // ---- Autres statuts (ex: 402 paiement) => stop (pas la peine de tourner)
      return res.status(status).json({
        error: "Erreur OpenRouter non récupérable.",
        details: payload,
        attempts,
      });

    } catch (err) {
      // Timeout / réseau
      console.error(`💥 Échec via ${name}:`, err.message);

      attempts.push({ key: name, status: "network_error", message: err.message });

      keyObj.errors += 1;

      // cooldown léger si timeout, pour éviter de taper toujours la même clé
      keyObj.disabledUntil = nowMs() + 10_000;

      lastError = { status: 500, details: { message: err.message } };
      continue;
    }
  }

  return res.status(500).json({
    error: "❌ Toutes les clés ont échoué (rate limit / clé invalide / provider down).",
    details: lastError,
    attempts,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Serveur lancé sur le port ${PORT}`));
