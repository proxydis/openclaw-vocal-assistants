# Utilisation — assistant vocal JARVIS

## Démarrer

1. Ouvrir `http://localhost:8480` sur la machine hôte, ou `https://<ip-de-la-machine>:8443` depuis un autre appareil (première fois : voir `INSTALLATION.md` § 4, puis saisir le code donné par `bin/jarvis code`).
2. Toucher **ACTIVER** et autoriser le micro. Ce geste est imposé par les navigateurs pour ouvrir le micro et le son ; l'écran reste ensuite allumé tant que la page est visible. Le micro s'ouvre au même moment (certains navigateurs ne l'accordent que pendant ce geste), mais ce qu'il entend pendant la séquence de démarrage (≈ 4 s, avec effets sonores synthétisés dans le navigateur) est ignoré. Pour la jouer sans le son : `localStorage.setItem("jarvis.sfx", "off")` dans la console du navigateur.
3. Parler.

## Parler aux agents

| Vous dites | Il se passe |
|---|---|
| « **Neo** » | Neo se réveille : l'orbe prend sa couleur, son avatar apparaît, il répond « Je vous écoute ». |
| « **Neo, lance les tests du projet** » | Réveil et demande en une seule phrase. |
| « Tu peux vérifier la CI, **Trinity** ? » | Le prénom en fin de phrase marche aussi. |
| « Et sur la branche principale ? » (dans les 2 min) | Suite de conversation avec le même agent, sans répéter le prénom. |
| « **Ada, relis le rapport** » pendant que Neo travaille | Ada démarre en parallèle. Neo continue ; sa réponse sera lue quand elle arrivera. |
| « **Stop** » (ou « arrête », « silence », « chut ») | La voix se coupe net. La tâche de l'agent **continue**. |
| « **Neo, annule** » | La tâche de Neo est interrompue. |

Les prénoms sont ceux de vos agents OpenClaw (les exemples de cette page — Neo, Ada, Trinity… — sont ceux de l'équipe d'exemple `config/agents.example.json`). « Hey », « dis », « ok », « bonjour » avant le prénom sont acceptés.

Bon à savoir :
- Sans prénom et plus de 2 minutes après le dernier échange, votre phrase s'affiche en gris avec la raison (« non transmis — dites le prénom ») puis disparaît : elle n'est envoyée à personne. Vous pouvez donc parler à quelqu'un d'autre dans la pièce.
- Un prénom **au milieu** d'une phrase ne réveille pas l'agent (« j'ai vu le rapport de Neo hier »).
- Pendant qu'un agent parle, seuls « stop » et un appel par prénom sont pris en compte, pour qu'il ne se réponde pas à lui-même. Pour l'interrompre et enchaîner : « Neo, … ».
- Chaque agent garde le fil : la conversation vocale vit dans sa session OpenClaw `agent:<id>:jarvis`, visible aussi dans l'interface de contrôle d'OpenClaw.

## Lire l'écran

- **Orbe** — sa couleur est celle de l'agent actif. Calme : à l'écoute. Ondes qui convergent : il vous entend. Anneaux qui accélèrent et étincelles en orbite : il réfléchit ou utilise un outil. Ondes qui rayonnent et membrane qui vibre : il parle.
- **Sous l'orbe** — le prénom et un mot d'état (« à l'écoute », « réflexion », « recherche web »…).
- **Sous-titres** — tout ce que vous dites (blanc) et tout ce que disent les agents (dans leur couleur, éclairé mot à mot au rythme de la voix). Les phrases ignorées passent en gris.
- **Rail des agents** (à gauche sur grand écran, en haut sur mobile) — un anneau par agent : plein = actif, tournant = au travail, pointillés = occupé ailleurs (Slack, Telegram, tâche planifiée). Sur grand écran, chaque agent a une **ligne de pouls** des 45 dernières secondes : plate = repos, ondulée = réflexion, pics blancs = appels d'outils, barres = parole. Toucher un agent le sélectionne sans parler.
- **Fenêtres** — les réponses orales sont volontairement courtes ; tableaux, listes, code et liens s'affichent dans une fenêtre flottante par agent (déplaçable par sa barre de titre, redimensionnable par le coin, `×` pour fermer ; sur mobile elles s'empilent en bas). Chaque fenêtre porte l'avatar de l'agent qui l'a ouverte. Plusieurs agents = plusieurs fenêtres en même temps.
- **Fenêtre navigateur** — seulement **si vous le demandez explicitement** (« montre-moi la doc de Piper dans une fenêtre », « ouvre le site… », « affiche la page… ») : sans ce genre de demande, aucun agent n'ouvre de page, même s'il en cite une. Exemple : « Neo, montre-moi la doc de Piper dans une fenêtre ». La page est rendue par un navigateur sur le machine hôte et retransmise en direct dans la fenêtre : tous les sites fonctionnent, y compris ceux qui interdisent l'intégration (GitHub, Google…). On peut cliquer, faire défiler, taper au clavier (cliquer dans la page d'abord), revenir en arrière (`‹`), recharger (`↻`) ou ouvrir la page dans un onglet (`↗`). Ce navigateur n'a pas vos cookies : les sites s'y affichent comme pour un visiteur anonyme.

## Commandes sans la voix

| Geste | Effet |
|---|---|
| Bouton micro, ou touche `M` | couper / rouvrir le micro |
| Bouton carré rouge (visible quand un agent parle), ou `Échap` | couper la voix |
| Bouton clavier, ou touche `/` | écrire au lieu de parler (« Neo, … ») — pratique dans le bruit ou en silence |
| Bouton horloge, ou touche `H` | **historique** des échanges avec l'agent actif (ou le dernier appelé) : tout ce que vous avez dit et ce qu'il a répondu, regroupé par jour avec l'heure de chaque message ; le détail affiché à l'écran se déplie sous chaque réponse ; des onglets en haut pour passer à un autre agent. L'historique vient de la session OpenClaw de l'agent : il survit aux redémarrages et se met à jour à chaque nouvel échange. |
| Toucher un agent dans le rail | le sélectionner |

## Changer un avatar

Bouton **silhouette** en bas de l'écran → la grille des avatars s'ouvre (tous les agents + vous).
- **Toucher un avatar** ouvre le sélecteur de fichiers (sur mobile : photothèque ou appareil photo). On peut aussi **glisser-déposer** une image sur un avatar.
- N'importe quelle image convient (JPEG, PNG, WebP…) : elle est recadrée en carré et redimensionnée dans le navigateur avant l'envoi. Le changement est immédiat, sur tous les appareils connectés, sans recharger.
- **↺ défaut** rétablit l'avatar d'origine.
- Votre propre avatar apparaît à côté de vos sous-titres.

Sans passer par l'interface : déposer `web/avatars/<prénom en minuscules, sans accents>.jpg` (vous : `user`). Sans image, un sigle holographique dérivé du prénom est dessiné ; « ↺ défaut » n'apparaît que si `web/avatars/defaults/<prénom>.jpg` existe.

## Conseils pour une bonne reconnaissance

- Marquer une courte pause après le prénom n'est pas nécessaire : parlez normalement, une phrase à la fois.
- Un micro proche (casque, micro de table) change tout. Avec des enceintes, gardez un volume modéré pour que « stop » soit bien entendu par-dessus la voix de l'agent.
- Si un prénom est régulièrement mal compris, regardez ce qui s'affiche en gris et ajoutez cette graphie aux `aliases` de l'agent dans `config/agents.json` (à créer depuis `config/agents.example.json` si vous utilisez la découverte automatique).
- Comptez environ 4 secondes entre la fin de votre phrase et le début de la réponse pour une question simple ; davantage si l'agent doit utiliser des outils (vous le voyez travailler sur l'orbe et sa ligne de pouls).
