# Tarot Africain (Poulpe / Ascenseur)

Jeu de cartes multijoueur en ligne pour 2 à 4 joueurs, jouable dans le navigateur
via un simple lien — sans compte, sans installation côté joueurs.

## Le jeu, en bref

- 22 cartes : les atouts 1 à 21 du tarot, plus l'Excuse.
- Chaque partie se déroule en cycles de 5 manches, avec de moins en moins de
  cartes distribuées : 5, 4, 3, 2, puis 1 carte. Cette dernière manche se joue
  **"au front"** : tu vois la carte de tous les autres joueurs, mais pas la
  tienne !
- Avant chaque manche, chaque joueur annonce combien de plis il pense
  remporter. Le total des annonces ne doit jamais tomber pile sur le nombre de
  cartes de la manche — le donneur (dernier à annoncer) n'a pas le droit de
  choisir la valeur qui équilibrerait le compte.
- À chaque pli, il faut jouer une carte plus forte que la meilleure carte déjà
  posée si on le peut ("monter"). L'Excuse vaut, au choix de celui qui la
  joue, la carte la plus forte ou la plus faible — mais ce choix n'est libre
  que si on entame le pli.
- Chaque joueur commence avec 10 vies. À la fin d'une manche, un contrat raté
  coûte autant de vies que l'écart entre l'annonce et les plis réellement
  remportés. Dès qu'un joueur tombe à 0 vie, la partie s'arrête : c'est le
  premier perdant, les autres sont classés par vies restantes.

## Lancer le jeu en local (pour tester)

Il faut [Node.js](https://nodejs.org/) (version 18 ou plus) installé sur ta
machine.

```bash
npm install
npm start
```

Le jeu est alors accessible sur `http://localhost:3000`. Ça ne fonctionne que
sur ton propre ordinateur — pour que tes amis puissent rejoindre depuis chez
eux, il faut déployer le jeu en ligne (voir ci-dessous).

Un test automatisé simule une partie complète (annonces, plis, manche au
front, fin de partie) pour vérifier que tout fonctionne :

```bash
npm test
```

## Mettre le jeu en ligne (lien public, gratuit)

Le jeu a besoin d'un petit serveur qui tourne en continu (il fait circuler les
coups entre les joueurs en temps réel). Voici deux façons gratuites de
l'héberger, au choix.

### Option A — Render (recommandé)

1. Crée un compte gratuit sur [render.com](https://render.com) (aucune carte
   bancaire requise pour le plan gratuit).
2. Mets ce dossier de code dans un dépôt GitHub : si tu n'as pas encore de
   dépôt, va sur [github.com/new](https://github.com/new), crée un dépôt (par
   exemple `tarot-africain`), puis suis les instructions de GitHub pour y
   pousser ce dossier (`git init`, `git add .`, `git commit`, `git push`).
3. Sur Render, clique **New +** → **Web Service**, puis connecte ce dépôt
   GitHub.
4. Render détecte automatiquement le fichier `render.yaml` fourni dans ce
   projet et pré-remplit la configuration (build : `npm install`, démarrage :
   `npm start`). Choisis le plan **Free**, puis clique **Create Web Service**.
5. Au bout de 1 à 2 minutes, Render te donne une URL du style
   `https://tarot-africain.onrender.com`. C'est ton lien public : envoie-le à
   tes 1 à 3 amis, chacun clique dessus et entre son prénom.

**À savoir** : sur le plan gratuit, le serveur s'endort après 15 minutes sans
visite et met 30 à 60 secondes à se réveiller au prochain clic sur le lien —
tout à fait normal, il suffit de patienter un peu au premier chargement.
L'état des parties est gardé en mémoire : si le serveur redémarre (mise en
veille, redéploiement), les salles en cours sont perdues et il faut recréer
une salle.

### Option B — Glitch (sans utiliser Git/GitHub)

1. Va sur [glitch.com](https://glitch.com) et crée un compte gratuit.
2. Clique **New Project** → **Import from GitHub** si tu as poussé le code sur
   GitHub, ou **New Project** → **glitch-hello-node** puis remplace les
   fichiers un par un par ceux de ce dossier (glisser-déposer fonctionne aussi
   pour importer un dossier complet selon les options de l'éditeur Glitch).
3. Glitch installe les dépendances et démarre le projet automatiquement. Ton
   lien public apparaît en haut à gauche, du style
   `https://tarot-africain.glitch.me`.

### Option C — Railway ou Fly.io

Ces deux plateformes fonctionnent sur le même principe que Render (connexion
à un dépôt GitHub, détection automatique de Node.js, déploiement en un clic)
et proposent aussi un plan gratuit ou à très faible coût. Si tu es déjà à
l'aise avec l'une d'elles, ce projet s'y déploie sans configuration
particulière (`npm install` puis `npm start`).

## Structure du projet

```
tarot-africain/
  server.js            serveur Express + Socket.io
  lib/gameRoom.js       toute la logique et les règles du jeu
  lib/roomRegistry.js   gestion des salles (création, codes, nettoyage)
  public/                le site que voient les joueurs
    index.html
    style.css
    game.js
  test/e2e-test.js      test automatisé (partie simulée de bout en bout)
  render.yaml            configuration de déploiement Render
```

## Limite connue

Les mains de cartes ne sont envoyées qu'à leur propriétaire (le serveur ne
transmet jamais aux autres joueurs les cartes qu'ils ne sont pas censés voir),
donc contrairement à une solution 100% côté navigateur, il n'y a pas de moyen
simple de "tricher" en inspectant les données reçues.
