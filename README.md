# Alétrain
Un HTML simple permettant de voyager de manière aléatoire en Suisse grâce à un tirage au sort du quai, du train et de l'arrêt de sortie. 

https://aletrain.lupachat.ch

## Tracé ferroviaire

Le serveur récupère les voies OpenStreetMap via Overpass et calcule un chemin
sur les rails entre les arrêts du train. Ce parcours est estimé : il ne s'agit
pas de la géométrie officielle de la circulation, notamment en cas de variantes
entre deux gares ou de déviation. Les données réseau sont conservées en mémoire
pendant 6 heures (12 zones au maximum) et les requêtes simultanées sont mutualisées.

L'instance utilisée par défaut est `https://overpass.private.coffee/api/interpreter`.
La variable d'environnement `OVERPASS_URL` permet d'utiliser sa propre instance.
Si le service est indisponible ou si les voies sont disjointes, l'interface affiche
un tracé simplifié en pointillés et l'indique explicitement.

Redémarrer le serveur après cette mise à jour pour activer `/api/rail-route`.
Lancer les tests du calcul avec `npm test`.

## Une idée à l’arrivée

Après le tirage de l’arrêt, « Et sur place ? » permet de tirer un lieu réel à
proximité, sans compte ni clé API. La recherche se déclenche uniquement avec
« Trouver une idée ». Les filtres repliés permettent de choisir une envie
(balade, découverte, manger ou boire), une marche maximale de 10, 20 ou 30 minutes,
et un budget gratuit ou indifférent. Par défaut : toutes les envies, 20 minutes,
budget indifférent. Les préférences sont conservées dans la session du navigateur.

`POST /api/activities` reçoit `{ "location": [latitude, longitude] }` et renvoie
`{ "activities": [...], "source": "OpenStreetMap" }`. Chaque lieu contient son
identifiant OSM, son nom, ses coordonnées, sa catégorie et une gratuité connue ou
inconnue. Les coordonnées invalides donnent une réponse 400 ; un fournisseur
indisponible donne une réponse 503, distincte d’une liste de lieux vide.

La recherche Overpass couvre un rayon de 1,7 km. Elle utilise en priorité
`https://overpass.osm.ch/api/interpreter`, puis le serveur Private.coffee en secours
si le premier échoue. Chaque tentative est limitée à 12 secondes. `OVERPASS_URL`
permet de remplacer ces fournisseurs par une instance choisie explicitement.
Le serveur Node doit disposer d'un accès HTTPS sortant : un lancement dans un
environnement qui interdit le réseau provoque une erreur `EACCES` dans ses logs.
Les résultats sont conservés 6 heures en mémoire, pour au maximum 100 gares.
Les requêtes simultanées identiques sont mutualisées. Un autre tirage ou un
changement de filtre réutilise les lieux chargés, sans nouvel appel au fournisseur.

La marche est estimée avec la distance à vol d’oiseau × 1,35, à 4,5 km/h : elle
ne garantit pas un chemin piéton accessible. Le filtre gratuit ne retient que les
lieux explicitement gratuits ; une entrée libre dans un café ne signifie pas une
consommation gratuite. Horaires et tarifs restent à vérifier sur la fiche OSM.
Le temps de l’activité est indépendant du temps de trajet disponible.

Redémarrer le serveur pour activer ce nouvel endpoint. `npm test` vérifie notamment
le classement, les filtres, le tirage sans répétition, le cache et l’API HTTP.


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
