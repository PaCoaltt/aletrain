# Alétrain
Un HTML simple permettant de voyager de manière aléatoire en Suisse grâce à un tirage au sort du quai, du train et de l'arrêt de sortie. 

## Lancer avec Docker

```bash
docker build -t aletrain .
docker run --rm -p 4173:4173 aletrain
```

Puis ouvrir `http://localhost:4173`.

## Validation admin des signalements via Telegram

Si vous configurez Telegram (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`), chaque nouveau signalement envoie un message à l'admin.

- Réponse `OK` (en répondant directement au message du bot) : le train supprimé est validé et visible pour tous les utilisateurs.
- Réponse `NON` : le signalement est supprimé pour tout le monde.

Le serveur expose l'endpoint `POST /api/telegram/webhook` pour recevoir les updates Telegram (à brancher avec un webhook Telegram).

## Lancer avec l'image Docker publiée

Une image est publiée automatiquement sur GitHub Container Registry (GHCR) à chaque push sur `main` et pour les tags `v*`.

```bash
docker pull ghcr.io/pacoaltt/aletrain:main
docker run --rm -p 4173:4173 ghcr.io/pacoaltt/aletrain:main
```
