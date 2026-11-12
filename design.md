# Design d’Alétrain

Alétrain est un outil de voyage aléatoire sur le réseau suisse. L’interface donne
la priorité aux réglages, au résultat du tirage et à la carte.

## Direction visuelle

- Inspiration : signalétique ferroviaire suisse et interfaces de planification.
- Fond gris légèrement chaud, surfaces blanches, texte presque noir.
- Rouge ferroviaire pour les actions principales et les repères du voyage.
- Vert réservé à la suggestion d’activité et à son repère sur la carte.
- Typographie système : Segoe UI Variable sur Windows, polices système sur Apple.
- Titres compacts, graisse affirmée, texte aligné à gauche et chiffres tabulaires.

## Composition

Sur ordinateur, une introduction courte précède deux colonnes asymétriques :
le formulaire continu à gauche et la carte, plus large, à droite. La carte reste
visible pendant le défilement. Les départs occupent la largeur en bas.

Sur mobile, le formulaire et la carte sont empilés. Les champs gardent une police
de 16 px et les commandes principales une hauteur minimale de 44 px. Les liens
vers la carte restent disponibles dans les résultats.

Le formulaire constitue une seule surface, séparée en étapes par des filets.
Les résultats se distinguent par leur contenu et une surface légèrement teintée.
Les filtres d’activités restent repliés par défaut.

## Composants

- Rayons : 8 px pour les commandes, 12 à 14 px pour les grands conteneurs.
- Bordures fines ; ombre légère réservée à la carte et aux fenêtres modales.
- Rouge plein pour l’action principale ; boutons secondaires blancs bordés.
- Focus clavier visible, contraste lisible et état désactivé explicite.
- Retour tactile discret au clic, transitions de 160 ms, respect de reduced-motion.
- Ne jamais appliquer de dimensions d’icône aux SVG de tracé Leaflet.

## Ton et contraintes

Écrire des états utiles et concrets : gare sélectionnée, durée, résultat, absence
de données ou erreur. Les indications d’estimation restent explicites.

Conserver une composition liée au voyage. Éviter les dégradés décoratifs, le verre
translucide, les grilles de cartes de présentation répétitives, les icônes
scintillantes et les animations sans fonction. Ne pas ajouter de faux indicateurs,
photos de destination inventées ou témoignages décoratifs.
