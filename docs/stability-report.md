# Stabilisation — 17 novembre 2026

## Diagnostic avant correction

Comparaison du commit `1be643f` (« v3 ») à `fc8d3fb` (comptes et signalements
retirés) et à `1dc2ff0` : l'internationalisation introduit une dépendance commune
à initialisation DOM synchrone, `i18n.js`, importée par la carte et le compteur.
Une erreur au chargement de ce module bloque donc les deux. Ce chemin de panne
est démontrable en interrompant son chargement ; **aucune exception commune n'a
été observée dans une session propre avec les fichiers effectivement déployés**.
Il ne faut pas présenter cette possibilité comme la cause certaine du problème
sur le navigateur de l'utilisateur.

Des lectures publiques de l'installation déployée ont confirmé :

- HTTP 200 et types JavaScript corrects pour Leaflet, l'application, le compteur,
  i18n et les quatre catalogues ; fichiers identiques au dépôt ;
- CSS identique à un BOM près, sans effet sur le rendu ; dimensions de carte
  définies sur desktop et mobile ;
- absence de CSP dans les en-têtes lus ;
- une tuile OSM répondant en HTTP 200 ;
- HTML et `/api/visits` en `no-store`, API renvoyant réellement `{"visits":0}` ;
- modules publics mis en cache 14 400 secondes par la chaîne HTTP observée,
  malgré les 300 secondes demandées auparavant par Node.

Ces GET n'enregistrent pas de visite. Aucune connexion au Pi ni changement
Cloudflare effectué. La carte vide n'a pas été reproduite en navigateur local
propre : initialisation Leaflet fonctionnelle, puis erreurs de tuiles dues au
réseau bloqué du bac à sable. En autorisant les seules lectures OSM, le test
navigateur charge de vraies images de tuiles 256 × 256. L'origine exacte d'un
éventuel blocage propre au navigateur de l'utilisateur reste à confirmer si le
problème persiste après mise à jour ; ni un cache obsolète ni un bloqueur réseau
ne sont affirmés sans preuve.

Le défaut de persistance du compteur est concret : chemin historique par défaut
`/app/visits.json`, compteur absent de l'image, exemples `docker run --rm` sans
volume. Une recréation selon cette procédure perd le fichier interne. Les
lancements optionnels avec `/metrics` peuvent avoir conservé un volume, mais
aucun montage du Pi n'a été inspecté : **le total ancien récupérable est inconnu**.
Le zéro public observé n'autorise ni reconstitution ni remise à zéro décidée ici.

## Corrections

- Carte Leaflet 1.9.4 conservée, contrôles, tracés et marqueurs conservés.
- Tuiles installées avant la traduction des contrôles ; traduction cartographique
  limitée au conteneur de carte au lieu de rebalayer toute l'application.
- Erreurs de chargement des tuiles et d'initialisation affichées avec leurs erreurs
  techniques dans la console ; erreur du graphe de modules rendue visible par
  `app-loader.js`. Les autres usages restent possibles si la carte échoue.
- Redimensionnement observé sur le conteneur ; retrait du `invalidateSize` initial
  temporisé et du gestionnaire resize redondant avec Leaflet.
- Compteur dissocié de l'initialisation i18n : l'appel de comptage démarre avant
  d'attendre ce module. Le dictionnaire français sans effet de bord sert de repli.
  Un problème de traduction est signalé, pas dissimulé.
- Repli GET et dernier total réel conservés avec avertissements réseau/stockage.
  Aucune valeur fictive de secours. Aucun POST déclenché par changement de langue,
  polling des horaires ou healthcheck.
- URLs versionnées sur tout le graphe applicatif, entrées v5, validation HTTP
  imposée sur les assets applicatifs, cache long réservé au vendor inchangé.
  Aucune modification des règles Cloudflare ; une règle personnalisée forcée
  pourrait encore nécessiter une vérification opérationnelle.

## Définition et stockage des visites

Total indicatif de visites, pas visiteurs uniques ni visiteurs actifs. Cookie
booléen commun `aletrain_visit=1`, valable 30 minutes et renouvelé à la visite :
un rechargement ordinaire dans le même navigateur n'ajoute pas une visite.
Aucune IP, empreinte ou donnée personnelle enregistrée. Sans cookies, plusieurs
onglets ouverts simultanément ou des bots peuvent surcompter ; définition historique
inchangée. Ce n'est pas une protection anti-abus.

Stockage `/data/visits.json` sur le volume externe dédié `aletrain-metrics`,
écrit toutes les 30 secondes par fichier temporaire puis renommage. L'arrêt propre
arrête les nouvelles connexions, attend les requêtes puis vide le compteur.
Une coupure brutale peut perdre les 30 dernières secondes. Le fichier absent ou
invalide empêche le démarrage en mode persistant ; jamais de zéro implicite.
Les erreurs d'écriture rendent le healthcheck dégradé et le compteur explicite.
Les scripts d'initialisation/import/inspection ne sont jamais lancés au démarrage.

## Suisse-allemand

`locales/gsw.js` couvre toutes les clés en variante bernoise / du Plateau. `gsw`
et `gsw-CH` sont reconnus ; `de-CH` reste `de`. Préférence conservée comme les
autres langues. Fallback `gsw → de → fr`, conventions numériques/date `de-CH`,
attribut `html.lang=gsw`. Aucun nom de gare ni d'opérateur traduit artificiellement.

## Docker, sécurité et migration

Compose conserve `4173:4173`, le nom `aletrain`, l'image GHCR et le tunnel existant.
Volume externe à créer/réutiliser explicitement, processus UID/GID 1000, source
en lecture seule, capacités Linux retirées, aucun socket Docker monté, logs bornés.
Les anciennes données utilisateurs restent intactes et non servies. Comptes,
signalements et Telegram restent absents ; limites JSON et concurrence Overpass
conservées. Backups et `.env` sont exclus de Git et du contexte Docker.

`/api/health` est en lecture seule, expose version et révision Git sans secrets,
et ne dépend pas des services externes. Le SHA est fourni par le workflow existant,
qui conserve AMD64 et ARM64. Une surcharge de healthcheck est fournie pour un
rollback vers une image historique sans cet endpoint.

Le README couvre les dix opérations demandées, avec migration du fichier ou d'un
snapshot GET réel, cas `--rm`, permissions, sauvegarde, restauration et rollback.
Le script refuse l'écrasement sans `--replace` et préserve alors le fichier précédent.
Un historique introuvable nécessite une décision explicite avant tout nouveau
compteur. Aucune migration ni suppression en production exécutée.

## Validation

- Tests Node : langues, recherche/tirage/retour, API publique, fichiers privés,
  cookie et visites persistantes, refus des données manquantes/corrompues,
  import/restore avec préservation, contrat Compose et publication multiarchitecture.
- Build sans bundler : graphe des modules statiques et dynamiques, syntaxe,
  complétude des cinq catalogues et paramètres de traduction.
- Navigateur réellement exécuté : Edge headless 157.0.4341.60, 1280 × 900 et
  390 × 844 ; cinq langues, préférence/rechargement, compteur réel de test,
  déduplication, Leaflet et images de tuiles, recherche, horaires, tracés, marqueurs
  et retour. Les horaires et tracés utilisent des fixtures ; les tuiles ont été
  testées avec une image de fixture puis avec les vraies tuiles OSM.
- Pannes testées : module i18n inaccessible, tuiles bloquées ; messages visibles,
  visites toujours enregistrées si i18n échoue ; pas d'erreur JavaScript inattendue
  sur le parcours normal. Les 30 secondes de rafraîchissement n'ajoutent pas de visite.
- Capture mobile suisse-allemand inspectée : pas de débordement horizontal.
- Docker n'est pas installé ici : contrat Compose contrôlé statiquement seulement.
  `docker compose config`, construction effective ARM64/AMD64 et permissions du
  volume existant doivent être confirmés lors du déploiement prévu par l'utilisateur.

## Avant publication

1. Pousser et attendre la publication GitHub Actions.
2. Identifier le conteneur actif et ses montages, sauvegarder et valider le compteur.
3. Migrer/réutiliser le volume sans écraser une statistique existante.
4. Libérer le nom/port uniquement de l'ancienne instance Alétrain sauvegardée.
5. `docker compose pull`, `docker compose up -d`, puis logs et `/api/health`.

Ne supprimer aucun ancien conteneur, image de rollback ou backup par défaut.
Les commandes `docker rm` documentées visent uniquement les noms de sauvegardes
arrêtées et confirmées inutiles, sans `-f` ni `-v`. Aucun nettoyage global ni
interruption d'autre service conseillé.

## Fichiers concernés

- Interface : `app.js`, `app-loader.js`, `index.html`, `styles.css`,
  `activity-ui.js`, `visit-counter.js`, `i18n.js` et les cinq fichiers de `locales/`.
- Compteur et exploitation : `server.mjs`, `visits.mjs`, `scripts/metrics-store.mjs`.
- Déploiement : `Dockerfile`, `compose.yaml`, `compose.legacy-health.yaml`,
  `.github/workflows/docker-image.yml`, `.dockerignore`, `.gitignore`.
- Vérifications : `scripts/build.mjs`, `scripts/check-browser.mjs`,
  `test/deployment.test.mjs`, `test/metrics-maintenance.test.mjs`,
  `test/i18n.test.mjs`, `test/server-public.test.mjs`, `test/visits-ui.test.mjs`.
- Documentation : `README.md` et ce rapport.

Validation finale : **42 tests Node réussis**, build réussi (19 fichiers de
production, 189 messages dans cinq langues), contrôle navigateur réussi en mode
fixtures puis en mode vraies tuiles OSM. Ces résultats ne sont pas une validation
Docker effective : cette dernière est maintenant ajoutée au workflow CI, dont
l'exécution reste à venir après publication des changements.
