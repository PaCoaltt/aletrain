# Alétrain
Un HTML simple permettant de voyager de manière aléatoire en Suisse grâce à un tirage au sort du quai, du train et de l'arrêt de sortie. 

https://aletrain.lupachat.ch

## Langues et actualisation

L'interface est disponible en français, allemand, suisse-allemand (`gsw`), italien et anglais. La langue
du navigateur est détectée à la première visite ; le sélecteur dans l'en-tête
permet de changer immédiatement de langue et conserve la préférence si possible.
Les traductions se trouvent dans `locales/{fr,de,gsw,it,en}.js`. Le suisse-allemand
est une variante bernoise / du Plateau, avec fallback vers `de` puis `fr`.
`de-CH` choisit l'allemand standard ; seul `gsw` choisit le suisse-allemand.

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
tentée ; si le service est indisponible, le dernier nombre rendu reste visible
avec un avertissement explicite. Le comptage démarre sans attendre l'initialisation
de l'i18n ; ses erreurs restent visibles dans la console et près du compteur.
Il est écrit au maximum toutes les 30 secondes, par remplacement de fichier, et
à l'arrêt propre du serveur. Une coupure brutale peut perdre les 30 dernières
secondes. Compose monte le volume dédié sur `/data`. Suivre la section
« Installation, mise à jour et maintenance Docker (Raspberry Pi) » ci-dessous
pour migrer une ancienne installation avant de remplacer le conteneur.

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


## Installation, mise à jour et maintenance Docker (Raspberry Pi)

Toutes les commandes ci-dessous sont à exécuter **sur le Pi, dans le dossier de
ce dépôt**, après publication de l'image par GitHub Actions. Elles ne sont pas
exécutées automatiquement. Docker Compose v2 est requis (`docker compose version`).
Le manifeste GHCR contient AMD64 et ARM64 : Docker choisit ARM64 sur le Pi 5.
Le conteneur se nomme `aletrain`, expose toujours `4173:4173` et ne monte aucun
socket Docker. Ne pas modifier le tunnel Cloudflare ni les autres services.

### 1. Identifier l'installation existante avant toute mise à jour

```bash
docker ps --filter publish=4173 --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}'
docker ps -a --filter name=aletrain --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
docker inspect --format '{{json .Mounts}}' aletrain
docker inspect --format 'AutoRemove={{.HostConfig.AutoRemove}} Image={{.Image}} Compose={{index .Config.Labels "com.docker.compose.project"}}' aletrain
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' aletrain | grep '^VISITS_FILE='
```

Ces lectures distinguent le conteneur publiant le port, les anciens conteneurs
arrêtés et leurs volumes. Ne pas déduire le conteneur actif de son nom seul.
L'absence de `VISITS_FILE` signifie historiquement `/app/visits.json` ; les
lancements précédemment conseillés pouvaient utiliser `/metrics/visits.json`.
Le nombre et le chemin réellement présents sur le Pi ne peuvent pas être déduits
du dépôt. Les anciens conteneurs peuvent avoir des totaux différents : ne pas les
additionner, choisir le plus grand automatiquement ou les remplacer par zéro.

### 2. Sauvegarder et migrer le compteur existant

Ne jamais supprimer l'ancien conteneur avant cette étape. Un lancement avec
`--rm` le supprime à l'arrêt : son fichier interne peut alors devenir irrécupérable.
Créer un dossier privé distinct pour chaque sauvegarde :

```bash
umask 077
BACKUP_DIR="$PWD/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
curl --fail --silent --show-error http://127.0.0.1:4173/api/visits > "$BACKUP_DIR/visits-live.json"
```

Le GET ne compte pas de visite. Valider le fichier avant de poursuivre ; un échec
HTTP ou un JSON sans entier `visits` n'est pas une sauvegarde exploitable. Ce
snapshot représente la valeur en mémoire à l'instant de lecture. Pour un conteneur
non éphémère, arrêter ensuite **le conteneur Alétrain identifié à l'étape 1** pour
vider ses écritures en attente, puis copier le fichier depuis le chemin vérifié :

```bash
docker stop --time 45 aletrain
docker cp aletrain:/app/visits.json "$BACKUP_DIR/visits-disk.json"
```

Adapter uniquement le chemin si `VISITS_FILE` indique `/metrics/visits.json` ou
autre chose. Si le conteneur était `AutoRemove=true`, effectuer aussi le `docker cp`
avant son arrêt ; la lecture HTTP récente peut être plus complète que le fichier,
écrit toutes les 30 secondes. Des visites entre le snapshot et l'arrêt peuvent
manquer : ce n'est pas une migration sans perte garantie. Garder les deux fichiers.
Si ni fichier ni snapshot valide n'est récupérable, **s'arrêter et décider
explicitement d'une éventuelle nouvelle statistique** ; ne pas initialiser à zéro.

Récupérer la nouvelle image et vérifier le volume nommé :

```bash
docker compose pull
docker volume inspect aletrain-metrics
```

Si ce volume dédié n'existe pas, le créer explicitement :

```bash
docker volume create aletrain-metrics
```

Le volume est déclaré `external` pour éviter qu'une faute de nom crée silencieusement
une nouvelle statistique. Si l'ancien volume a un autre nom, le renseigner dans
`.env` avec `ALETRAIN_METRICS_VOLUME=nom_verifie` et ne pas en créer un second.
Ne jamais désigner un volume d'un autre service.

Le nouveau processus utilise l'utilisateur `node` (UID/GID 1000). Après avoir
vérifié que ce volume appartient exclusivement à Alétrain, corriger uniquement
les permissions de son répertoire et de son fichier si l'ancien conteneur était root :

```bash
docker compose run --rm --no-deps --user 0 --cap-add CHOWN --entrypoint sh aletrain -c 'chown 1000:1000 /data; if [ -f /data/visits.json ]; then chown 1000:1000 /data/visits.json; fi; if [ -f /data/visits.json.tmp ]; then chown 1000:1000 /data/visits.json.tmp; fi'
docker compose run --rm --no-deps aletrain node scripts/metrics-store.mjs inspect --file /data/visits.json
```

Si un compteur valide existe déjà dans le bon volume, le conserver. Sinon,
inspecter puis importer **le snapshot choisi et validé** (exemple : lecture HTTP) :

```bash
docker compose run --rm --no-deps -v "$BACKUP_DIR:/import:ro" aletrain node scripts/metrics-store.mjs inspect --file /import/visits-live.json
docker compose run --rm --no-deps -v "$BACKUP_DIR:/import:ro" aletrain node scripts/metrics-store.mjs import --source /import/visits-live.json --file /data/visits.json
```

L'import refuse d'écraser un fichier existant. `--replace` est réservé à une
restauration décidée après comparaison : une copie du fichier remplacé est conservée.
L'application refuse de démarrer si le fichier manque ou est invalide, au lieu de
réinitialiser silencieusement les statistiques. Ne jamais faire écrire deux
instances d'Alétrain dans le même fichier.

Si l'utilisateur du Pi n'a pas l'UID 1000, les fichiers de sauvegarde privés
peuvent être illisibles pour `node`. Ne pas les rendre publics : utiliser
`--user 0 --cap-add DAC_OVERRIDE` uniquement pour la commande ponctuelle
d'inspection/import, puis
redonner `/data/visits.json` à `1000:1000` avec la commande ciblée ci-dessus.
Ces capacités ne sont accordées qu'au conteneur de maintenance éphémère ; le
service web conserve `cap_drop: ALL`.

### 3. Installation initiale réellement neuve

Uniquement s'il n'existe aucun historique à conserver et qu'un nouveau compteur
est souhaité : `docker compose pull`, créer le volume dédié comme ci-dessus,
vérifier ses permissions, puis l'initialiser explicitement :

```bash
docker compose run --rm --no-deps aletrain node scripts/metrics-store.mjs init --file /data/visits.json --new
```

Cette commande refuse tout fichier existant. Avant le premier `up`, si le nom
`aletrain` est occupé par un ancien conteneur **autonome** déjà arrêté et sauvegardé,
le renommer avec un suffixe disponible, sans le supprimer :

```bash
docker rename aletrain "aletrain-legacy-$(date +%Y%m%d-%H%M%S)"
docker compose config
docker compose up -d
```

Ne pas renommer le conteneur si c'est déjà celui du projet Compose `aletrain` :
Compose le réutilise ou le recrée. Un ancien nom de sauvegarde n'est jamais écrasé.

### 4. Démarrage et arrêt

```bash
docker compose up -d
docker compose stop
docker compose start
```

`restart: unless-stopped` redémarre Alétrain après un redémarrage du Pi, sauf arrêt
manuel. `stop` conserve le conteneur et le volume. Le serveur vide le compteur à
l'arrêt propre ; le délai de 45 secondes laisse finir les requêtes en cours.
Une coupure brutale peut perdre les visites des 30 dernières secondes.

### 5. Mise à jour après GitHub Actions

Attendre le succès du workflow de publication. Avant la mise à jour, sauvegarder
le compteur (section suivante) et garder l'image courante pour un retour arrière :

```bash
CURRENT_IMAGE=$(docker inspect --format '{{.Image}}' aletrain)
ROLLBACK_IMAGE="aletrain-local:rollback-$(date +%Y%m%d-%H%M%S)"
docker image tag "$CURRENT_IMAGE" "$ROLLBACK_IMAGE"
printf '%s\n' "$ROLLBACK_IMAGE"
docker compose pull
docker compose up -d
docker compose ps
```

Noter le tag de retour arrière. En usage courant, les deux commandes de mise à
jour sont simplement `docker compose pull` puis `docker compose up -d`.
Ne pas lancer un second `docker run -p 4173:4173` à côté de Compose.
Le volume externe est réutilisé lors du remplacement du conteneur.

### 6. Logs, santé et version déployée

```bash
docker compose logs --tail=100 aletrain
docker compose logs -f --tail=100 aletrain
curl --fail http://127.0.0.1:4173/api/health
docker inspect --format '{{.State.Health.Status}}' aletrain
docker inspect --format '{{.Image}}' aletrain
docker image inspect "$CURRENT_IMAGE" --format '{{.Architecture}} {{json .RepoDigests}}'
```

Pour l'image actuellement exécutée, recalculer `CURRENT_IMAGE` avec la commande
de la section 5. `/api/health` expose version et SHA Git intégré à la construction,
sans secrets. Il ne dépend pas d'OSM ni de l'API ferroviaire ; une erreur connue
d'écriture du compteur le rend dégradé. Un conteneur `unhealthy` n'est pas
automatiquement redémarré par Docker : consulter les logs et les permissions.
Les logs sont limités à trois fichiers de 5 Mo.

### 7. Sauvegarde et restauration

Pour une sauvegarde cohérente du fichier, arrêter uniquement Alétrain, copier,
puis le redémarrer. Créer d'abord un nouveau `BACKUP_DIR` privé comme à l'étape 2 :

```bash
docker compose stop
docker cp aletrain:/data/visits.json "$BACKUP_DIR/visits.json"
docker compose start
```

Conserver aussi `compose.yaml`, le digest de l'image et le `.env` éventuel dans
une sauvegarde privée. Les backups et `.env` sont exclus de Git et de l'image.
Pour restaurer, arrêter Alétrain, vérifier le JSON choisi avec `inspect`, puis :

```bash
docker compose stop
docker compose run --rm --no-deps -v "$BACKUP_DIR:/import:ro" aletrain node scripts/metrics-store.mjs inspect --file /import/visits.json
docker compose run --rm --no-deps -v "$BACKUP_DIR:/import:ro" aletrain node scripts/metrics-store.mjs import --source /import/visits.json --file /data/visits.json --replace
docker compose up -d
```

Ne pas continuer après une erreur de validation ou de permission. La restauration
conserve l'ancien fichier dans le volume avec un suffixe `.backup-…`.

### 8. Retour à la version précédente

Après sauvegarde, remplacer la valeur par le tag de retour arrière noté :

```bash
ALETRAIN_IMAGE=aletrain-local:rollback-TAG_NOTE docker compose up -d --pull never
```

Le volume reste identique ; ne pas restaurer un compteur ancien simplement pour
changer de version du code. Pour rester sur cette image, inscrire le tag dans
`.env`. Si l'image précédente date d'avant `/api/health`, utiliser le contrôle de
santé compatible fourni, qui lit le compteur sans ajouter de visite :

```bash
ALETRAIN_IMAGE=aletrain-local:rollback-TAG_NOTE docker compose -f compose.yaml -f compose.legacy-health.yaml up -d --pull never
```

### 9. Nettoyage ciblé des anciens conteneurs et images

Ces commandes sont des exemples **à exécuter seulement après avoir confirmé que
la ressource est inutile et ses données sauvegardées**. Aucune suppression automatique :

```bash
docker ps -a --filter name=aletrain --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
docker inspect --format '{{.State.Status}} {{json .Mounts}}' aletrain-backup
docker inspect --format '{{.State.Status}} {{json .Mounts}}' aletrain-backup-20261117
```

Pour chaque ancien conteneur effectivement arrêté et validé comme inutile :

```bash
docker rm aletrain-backup
docker rm aletrain-backup-20261117
```

Exécuter seulement la ligne concernant la ressource vérifiée, sans `-f` ni `-v`.
Ne pas supprimer le conteneur actif `aletrain`, ses volumes ou les sauvegardes
existantes sans décision explicite. Pour une image Alétrain candidate au nettoyage :

```bash
docker image ls --digests ghcr.io/pacoaltt/aletrain
docker image inspect IMAGE_ID_VERIFIE
docker ps -a --filter ancestor=IMAGE_ID_VERIFIE
docker image rm IMAGE_ID_VERIFIE
```

La dernière ligne n'est autorisée qu'après vérification de l'appartenance à
Alétrain, de l'absence de conteneur dépendant et de l'inutilité pour le rollback.
Aucun `system prune`, nettoyage global, suppression de volume ou arrêt d'un
autre service n'est nécessaire.

### 10. Conflits de port, volumes et variables

Si le port 4173 est occupé, identifier d'abord son propriétaire :

```bash
docker ps --filter publish=4173 --format 'table {{.ID}}\t{{.Names}}\t{{.Ports}}'
sudo ss -ltnp 'sport = :4173'
```

Si c'est une ancienne instance Alétrain, suivre sa sauvegarde/migration puis son
arrêt ciblé. Si c'est un autre service, ne pas l'arrêter ni changer les ports ou
Cloudflare au hasard : résoudre le conflit explicitement. Un conflit de nom se
résout par inspection puis renommage de l'ancien conteneur sauvegardé, pas par
suppression forcée.

| Variable | Valeur / rôle |
| --- | --- |
| `ALETRAIN_IMAGE` | Image Compose, défaut `ghcr.io/pacoaltt/aletrain:main` ; tag local ou digest pour rollback. |
| `ALETRAIN_METRICS_VOLUME` | Volume externe dédié, défaut `aletrain-metrics`. |
| `VISITS_FILE` | Fixé à `/data/visits.json` dans Compose ; compte réel persistant. |
| `REQUIRE_VISITS_FILE` | Fixé à `1` : interdit une remise à zéro implicite. |
| `PORT` | Fixé à `4173`. |
| `OVERPASS_URL` | Facultatif : endpoint Overpass existant à conserver si personnalisé. |
| `APP_REVISION` | SHA fourni à la construction par GitHub Actions ; visible dans `/api/health`. |

Mettre les surcharges locales dans `.env` (non versionné), sans secrets dans le
dépôt. Les anciennes variables de comptes/Telegram ne sont plus utilisées.
Le système de fichiers du conteneur est en lecture seule, sauf `/data` et `/tmp` ;
les capacités Linux sont retirées. Les protections de taille des requêtes et de
concurrence Overpass sont conservées. Les routes de comptes et signalements restent absentes.

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

L'image reste publiée automatiquement vers GHCR à chaque push sur `main` et pour
les tags `v*`, pour `linux/amd64` et `linux/arm64`.

## Tests locaux de non-régression

`npm test` et `npm run build` ne demandent aucune dépendance externe.
Le contrôle Compose effectué par les tests est statique : exécuter aussi
`docker compose config` sur une machine disposant de Docker.

Un contrôle navigateur optionnel utilise Playwright, installé séparément comme
outil de développement, sans l'ajouter à l'application ni à l'image de production :

```bash
node scripts/check-browser.mjs /chemin/vers/playwright/index.mjs
node scripts/check-browser.mjs /chemin/vers/playwright/index.mjs --live-tiles
```

`BROWSER_CHANNEL=msedge` permet d'utiliser Edge installé ; sinon le Chromium de
Playwright doit être disponible. Le test démarre un serveur local et un compteur
temporaire, simule les horaires et les tracés, et n'appelle jamais le compteur de
production. Le second mode charge réellement les tuiles OSM. Il vérifie les cinq
langues, le rechargement, la recherche, le tirage, le retour, la carte, les erreurs
et l'absence de débordement horizontal à 390 px. Les captures vont dans `.audit/`,
exclu de Git et de l'image.
