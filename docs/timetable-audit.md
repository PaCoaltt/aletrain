# Audit horaires et internationalisation — 17 novembre 2026

## Verdict

**Partiellement actualisés.** Alétrain peut afficher des prévisions effectivement
renvoyées par l'API, mais revient aux horaires théoriques lorsqu'elles manquent.
Ni une heure seule, ni un quai seul, ni la réussite d'une requête ne prouvent la
présence ou la fraîcheur du temps réel à la source. Aucun horodatage du flux amont
n'est exposé dans les objets utilisés : « reçus à » désigne la réception par le
navigateur, pas l'instant de production du flux.

## Architecture et documentation

Application sans framework : HTML, CSS et modules JavaScript natifs ; serveur
HTTP Node, Leaflet fourni dans le dépôt, aucune dépendance npm applicative.

Le navigateur appelle directement `https://transport.opendata.ch/v1` :

- `/locations` : recherche par nom et recherche à proximité ;
- `/stationboard` : tableau de départs et arrêts intermédiaires ;
- `/connections` : vérification du retour au départ de l'arrêt tiré.

Ce fournisseur est conservé. Selon sa documentation actuelle, il exploite son
propre exemplaire du GTFS suisse et les GTFS-RT d'opentransportdata.swiss, avec
un calculateur MOTIS pour les correspondances. Le Pi ne télécharge pas ces flux.

Références officielles consultées :

- [Transport API : objets Stop et Prognosis, limites et sources](https://transport.opendata.ch/docs.html)
- [GTFS-RT suisse : couverture, fenêtre et actualisation](https://opentransportdata.swiss/de/cookbook/realtime-prediction-cookbook/gtfs-rt/)
- [Organisations avec données temps réel, actuelles ou annoncées](https://data.opentransportdata.swiss/dataset/go-realtime)

La documentation Transport API annonce une lecture des mises à jour toutes les
30 secondes pour les tableaux et chaque minute pour le calculateur, et un retard
d'environ une minute au maximum par rapport à sa source. C'est l'annonce du
fournisseur, pas une latence mesurée par cet audit.

Le cookbook suisse annonce une fenêtre de prévision de trois heures et seulement
les organisations qui transmettent des données temps réel. La liste publiée inclut
aussi des participations futures : elle ne garantit pas chaque ligne ou course.
Une liste d'opérateurs n'est donc pas une preuve de couverture exhaustive.

## Vérification effective des réponses

Trois requêtes publiques, effectuées le 17 novembre 2026 vers **19:12:44, heure
suisse**, ont demandé huit trains à Lausanne (8501120), Zürich HB (8503000) et
Coire/Chur (8509000). Le service a renvoyé 26 entrées au total : sa limite peut
inclure plusieurs départs simultanés.

- 25 entrées avaient une prévision de départ non nulle ;
- six avaient un retard strictement positif ;
- Lausanne R4 : départ prévu `19:27`, `prognosis.departure = 19:29`, `delay = 2` ;
- Chur RE7 : `delay = null`, `prognosis.departure = null` : temps réel non confirmé ;
- `prognosis.platform` était nul sur cet échantillon ;
- aucune suppression explicite ni changement de voie n'a été observé.

L'échantillon contient SBB, RhB, THURBO et SOB-sob. Il prouve la présence de
prévisions et de retards sur ces réponses, sans vérifier leur exactitude sur le
terrain ni permettre une conclusion sur toutes les lignes ou tous les opérateurs.

## Champs et traitement

| Champ | Traitement |
| --- | --- |
| `stop.departure`, `arrival` | Horaire théorique de repli. Jamais qualifié de temps réel à lui seul. |
| `prognosis.departure`, `arrival` | Prioritaire uniquement si date valide. Indication « Prévision reçue ». |
| `stop.delay` | Retard documenté en minutes ; `null` reste inconnu, `0` explicite peut indiquer la ponctualité. |
| Écart entre horaire et prévision valides | Peut afficher l'écart de retard ou d'avance effectivement fourni par ces deux heures. Aucun retard créé si les données manquent. |
| `prognosis.platform` | Prioritaire lorsqu'il est renseigné ; comparaison à la voie théorique pour afficher le changement. |
| `cancelled` / `canceled` booléen | Pris en compte défensivement s'il est présent : affichage et exclusion du tirage. |

La documentation v1 n'établit pas de champ universel de suppression dans les
objets Stop/Journey. Le fournisseur annonce ingérer les suppressions GTFS-RT,
mais cela ne garantit pas une ligne « supprimé » pour chaque cas : une course
peut simplement ne plus figurer dans la réponse. **Une disparition n'est jamais
interprétée automatiquement comme une suppression.** Les tests de booléens ne
constituent pas une preuve que chaque suppression réelle est exposée ainsi.

Les perturbations textuelles SIRI-SX/GTFS Service Alerts et positions réelles des
véhicules ne sont pas intégrées ici. Pour une couverture plus explicite des
événements, une étude OJP/SIRI-SX ou GTFS-RT direct avec clé pourrait être proposée,
en comparant couverture, identifiants, coûts d'intégration et quotas. Aucun
changement de fournisseur n'a été effectué.

## Actualisation et caches

Avant ce changement : chargement à la sélection de gare et au tirage ; pas de
rafraîchissement automatique. Les prévisions étaient prioritaires, mais le retard
chiffré et les changements de voie restaient peu explicites. Les heures de la liste
intermédiaire utilisaient encore les arrivées théoriques.

Après ce changement :

- rechargement des départs toutes les 30 secondes quand l'onglet est visible ;
- rechargement au retour sur l'onglet, sans requêtes superposées ;
- vérification manuelle conservée au tirage, marge d'embarquement de deux minutes ;
- suspension de l'actualisation pendant une recherche ou un tirage ;
- invalidation du tirage si le départ choisi disparaît, change d'heure, de voie,
  d'arrêt ou de statut ;
- en cas d'échec, anciennes données signalées et confirmation d'arrêt désactivée ;
- préférence donnée aux prévisions dans les arrêts intermédiaires et à l'arrivée ;
- vérification du retour lors du tirage de l'arrêt, sans polling des itinéraires de
  retour. Son heure de vérification reste affichée : il faut le reconfirmer avant
  le voyage retour.

Les requêtes horaires du navigateur utilisent `cache: no-store` et un délai de
15 secondes. Il n'y a pas de cache d'horaires sur le Pi. Les caches amont restent
sous la responsabilité du fournisseur et une prévision présente peut être ancienne.
L'intervalle JavaScript est une cible : navigateur, veille et réseau peuvent le retarder.
Le seuil d'une minute pour revérifier un arrêt est conservé.

Les caches de six heures concernent le réseau ferroviaire OSM et les activités,
pas les horaires. Le cache des fichiers statiques du Pi est conservé ; les URL
d'entrée ont une nouvelle version pour éviter le mélange avec les anciens scripts.

## Internationalisation

`i18n.js` fournit détection, fallback français, interpolation, pluriels et formats
`Intl`. Les dictionnaires sont `locales/fr.js`, `de.js`, `it.js` et `en.js`.
Le sélecteur natif accessible affiche Français, Deutsch, Italiano et English.
La préférence `aletrainLanguage` est enregistrée si le stockage est disponible ;
sinon l'application reste utilisable. La première langue compatible du navigateur
est utilisée, à défaut le français. `html.lang` et les libellés accessibles suivent.

Les textes statiques conservent un français de repli dans le HTML. Les textes
dynamiques portent une clé et des paramètres pour être retraduits immédiatement,
y compris les résultats déjà tirés, le retour, les activités, les erreurs, la carte,
les crédits et le compteur. Les dates/heures restent en fuseau Europe/Zurich et
suivent la locale sélectionnée ; les nombres et pluriels utilisent `Intl`.
Les noms officiels reçus et les noms de lieux OSM restent inchangés ; aucun
paramètre de localisation non documenté n'est inventé pour l'API.

## Validation et déploiement

`npm test` couvre notamment les quatre catalogues, leurs paramètres, le fallback,
la langue du navigateur, la mémorisation, les pluriels, les attributs accessibles,
les résultats, les prévisions absentes, les erreurs et l'actualisation des départs.

Le projet n'a pas de compilation ou bundler : `npm run build` valide le graphe
des fichiers de production, la syntaxe JavaScript, les catalogues et les références
de traduction HTML. Cette commande est aussi exécutée dans le Dockerfile.

Node 22 Alpine, port 4173 et publication GitHub Actions `linux/amd64,linux/arm64`
vers GHCR sont conservés ; aucune bibliothèque native ajoutée. Le Dockerfile
contenait deux étapes identiques : le doublon a été retiré, sans changer son
image finale ni ses paramètres. Docker n'est pas installé dans cet environnement :
la construction ARM64 réelle doit être confirmée par le workflow existant.

La vérification visuelle a été tentée mais l'automatisation Firefox a été arrêtée
par l'outil : la politique d'URL n'est pas prise en charge pour ce navigateur
Windows. Aucun contournement n'a été tenté. Les règles mobiles limitent les
largeurs et permettent le retour à la ligne ; un contrôle visuel mobile et des
quatre langues reste nécessaire avant publication.

Pour déployer : pousser les changements validés, attendre le succès du workflow,
tirer la nouvelle image et recréer le conteneur avec ses volumes et variables
existants. Aucun déploiement ni changement de données historiques effectué ici.
