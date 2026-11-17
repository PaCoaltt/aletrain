# Alétrain
Un HTML simple permettant de voyager de manière aléatoire en Suisse grâce à un tirage au sort du quai, du train et de l'arrêt de sortie. 

https://aletrain.lupachat.ch

## Langues et actualisation

L'interface est disponible en français, allemand, italien et anglais. La langue
du navigateur est détectée à la première visite ; le sélecteur dans l'en-tête
permet de changer immédiatement de langue et conserve la préférence si possible.
Les traductions se trouvent dans `locales/{fr,de,it,en}.js`, avec fallback français.

Les horaires sont **partiellement actualisés** : les prévisions et retards sont
affichés lorsqu'ils sont fournis ; leur absence reste explicitement signalée.
Les départs sont rafraîchis toutes les 30 secondes quand la page est visible,
ainsi qu'au tirage. Les données anciennes sont signalées après un échec.
Le retour reste une vérification ponctuelle au tirage de l'arrêt.

Voir le [rapport d'audit détaillé](docs/timetable-audit.md) pour les champs,
la couverture, les réponses réellement observées et les limites du fournisseur.

Validation : `npm test` puis `npm run build`. L'application utilise des modules
natifs sans bundler ; le build vérifie les fichiers de production et les traductions.

## Départs, aventures et retour

Les horaires viennent de `https://transport.opendata.ch/v1`, qui réutilise les
horaires GTFS et le temps réel GTFS-RT d'opentransportdata.swiss. Les appels sont
effectués directement depuis le navigateur, sans nouvelle clé API côté Pi.

Chaque tirage recharge les départs. Les prévisions d'heure
et de quai priment sur l'horaire théorique. Une marge de 2 minutes avant le départ
est imposée ; les suppressions connues des données de transport sont exclues.
L'absence de prévision est indiquée comme « Horaire prévu » : elle ne confirme pas
la circulation du véhicule. Un arrêt tiré plus d'une minute après la vérification
nécessite un nouveau tirage du transport. Les annonces sur place restent à consulter.

Les variantes autorisent les trains seuls, trains et bateaux, trains et transports
à câble, ou tous les modes (avec bus et trams). Elles utilisent les départs du point
choisi, sans recherche automatique de débarcadère ni de correspondance à l'aller.
Un mode autorisé n'est donc pas garanti dans le tirage. Pour les transports sans
quai fourni, le point de départ doit être vérifié sur place. Le tracé ferroviaire
OSM est réservé aux trains ; les autres modes affichent une ligne indicative.

« Prévoir mon retour » ajoute une date et une heure limites **en heure suisse**
et un temps minimum sur place. La destination du retour est le point de départ.
Avant de confirmer l'arrêt, Alétrain cherche via `/connections` un retour qui part
après ce temps sur place et arrive avant la limite, prévisions comprises. Il
affiche les étapes, les changements et la date d'arrivée. La recherche teste au
maximum 6 arrêts en ordre aléatoire, 4 itinéraires par arrêt, en requêtes successives.
Un échec ou une indisponibilité ne valide aucune destination : cela ne prouve pas
qu'aucun retour n'existe. Les modes du retour sont ceux de l'aventure choisie.
Le temps sur place doit inclure la marche et la marge pour rejoindre le départ.
Les activités proposées ne sont pas automatiquement limitées à cette durée.

## Compteur et hébergement sur Raspberry Pi

Le pied de page affiche un total indicatif de visites depuis l'installation du
compteur. Un cookie commun, sans identifiant individuel, évite de recompter le
même navigateur pendant 30 minutes d'activité. Aucun IP, historique ou service
d'analyse tiers n'est enregistré par le compteur. Les navigateurs sans cookies,
les bots et plusieurs onglets ouverts simultanément peuvent gonfler le total :
ce ne sont pas des visiteurs uniques et ce n'est pas un outil de protection anti-abus.

Le compteur utilise `visits.json` (ou le chemin `VISITS_FILE`). Il est affiché dès
la réponse HTML du serveur puis actualisé par `visit-counter.js`, indépendamment
du chargement de la carte et du tirage. Si le POST échoue, une lecture GET est
tentée ; si le service est indisponible, le dernier nombre rendu reste visible.
Il est écrit au maximum toutes les 30 secondes, par remplacement de fichier, et
à l'arrêt propre du serveur. Une coupure brutale peut perdre les 30 dernières
secondes. Avec Docker, monter un volume persistant pour conserver le compteur
entre deux remplacements de conteneur, par exemple ajouter :

```bash
-v aletrain-metrics:/metrics -e VISITS_FILE=/metrics/visits.json
```

Les fichiers publics sont conservés en mémoire après leur première lecture :
redémarrer Node après une mise à jour. Ils sont les seuls fichiers servis ;
`data.json`, le compteur, les sources serveur et les fichiers Git restent privés.
Les requêtes JSON sont limitées à 64 Kio. Les caches Overpass et les limites de
2 recherches simultanées par service restent en place. Une indisponibilité du
tracé garde la carte en mode simplifié et ne bloque pas le tirage.

Une présence dans un showcase ne permet pas de prévoir l'audience. La charge la
plus variable reste le calcul des tracés ferroviaires, la mémoire des réseaux et
le débit montant du Pi. Avant une mise en avant, mesurer CPU, RAM et latence sur
le Pi avec des utilisateurs simultanés, notamment des tracés non présents en cache.
Le compteur seul ne mesure pas ces paramètres. En cas d'affluence ou d'abus, prévoir
une limitation des requêtes sur le reverse proxy.

`npm test` couvre les prévisions, les retours incompatibles, les fuseaux horaires,
les flux de tirage et la persistance du compteur, en plus des services OSM.

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

## Accès public et anciennes données

Toute l'application est accessible directement, sans compte. Les interfaces et
API de profils, sessions, signalements et Telegram ont été retirées. Les anciennes
variables Telegram peuvent être retirées du déploiement ; le serveur ne les utilise
plus. Aucune dépendance externe n'était dédiée à ces fonctionnalités : les imports
de chiffrement et la lecture/écriture de leur base ont été supprimés.

Le fichier `data.json` existant est conservé sans modification. Le serveur ne le lit
plus, ne le sert pas et ne le migre pas au démarrage. Les anciennes données locales
du navigateur restent inutilisées. Les nouvelles images Docker excluent `data.json`
et ses sauvegardes ; conserver le fichier de l'ancien conteneur ou son volume avant
de remplacer ce conteneur si une archive est souhaitée.

Un script indépendant prépare le nettoyage. **Ne l'appliquer qu'après validation**,
sur le fichier choisi et avec l'ancienne application arrêtée. L'inspection seule
ne modifie aucun fichier et n'affiche aucun nom, mot de passe ou signalement :

```bash
node scripts/cleanup-legacy-data.mjs --file /chemin/data.json
```

Après validation, l'option `--apply` sauvegarde d'abord le fichier à côté de
l'original, puis retire uniquement `users`, `reports` et `telegramUpdateOffset`,
en conservant toutes les autres clés. La sauvegarde contient encore des données
personnelles et doit rester privée. Le compteur `visits.json` est indépendant
et n'est pas concerné. Ce script n'est jamais exécuté automatiquement.

## Lancer avec l'image Docker publiée

Une image est publiée automatiquement sur GitHub Container Registry (GHCR) à chaque push sur `main` et pour les tags `v*`.

```bash
docker pull ghcr.io/pacoaltt/aletrain:main
docker run --rm -p 4173:4173 ghcr.io/pacoaltt/aletrain:main
```
