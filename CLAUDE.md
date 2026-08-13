# InfiniClick

Un **clicker infini** en HTML5 Canvas, inspiré de *ZenShards*. Une balle rebondit
sur une grille de blocs destructibles ; chaque impact fissure un bloc, chaque bloc
brisé libère des **fragments** que l'on dépense en améliorations. La grille se
régénère sans fin — la boucle de jeu ne s'arrête jamais, elle ne fait que grandir.

## Boucle de jeu

1. Une ou plusieurs balles rebondissent sur les murs et les blocs.
2. Chaque rebond (ou chaque clic) retire des points de vie à un bloc.
3. Un bloc à 0 PV se brise, verse des fragments et réapparaît après quelques secondes.
4. Les fragments achètent des améliorations qui accélèrent la récolte.
5. Retour à l'étape 1, indéfiniment.

## Lancer le jeu

Aucune dépendance, aucune étape de build. Ouvre simplement `index.html` dans un
navigateur. Pour un serveur local :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

## Structure du projet

| Fichier      | Rôle                                                              |
|--------------|------------------------------------------------------------------|
| `index.html` | Structure de la page : barre de stats, canvas, boutique.         |
| `style.css`  | Thème sombre « zen », mise en page et style de la boutique.      |
| `game.js`    | Toute la logique : physique, rendu, économie, améliorations, sauvegarde. |
| `CLAUDE.md`  | Ce document.                                                      |

## Architecture de `game.js`

Le code est encapsulé dans une IIFE (aucune variable globale) et organisé en sections :

- **`state`** — progression persistée (fragments, niveaux d'améliorations, multiplicateurs).
- **`runtime`** — données éphémères non sauvegardées (balles, blocs, particules, textes flottants).
- **Grille** (`layoutGrid`, `makeBlock`, `blockRect`) — dispose les blocs et calcule leur géométrie de façon responsive.
- **Physique** (`collideBallBlocks`) — collision cercle/rectangle résolue par axe de moindre pénétration.
- **Économie** (`breakBlock`, `damageBlock`) — dégâts, récompenses en fragments, effets visuels.
- **Boutique** (`UPGRADES`, `costOf`, `buy`, `renderShop`) — améliorations à coût géométrique.
- **Rendu** (`render`) — dessine blocs, fissures, particules, balles et textes flottants.
- **Persistance** (`save`, `load`) — sauvegarde automatique dans `localStorage` (clé `infiniclick.save.v1`).
- **Boucle** (`frame`) — `requestAnimationFrame` avec `dt` borné pour rester stable après un changement d'onglet.

## Améliorations

| Amélioration            | Effet                                           |
|-------------------------|-------------------------------------------------|
| Puissance de la balle   | +1 dégât par rebond.                             |
| Doigt tranchant         | +1 dégât par clic.                               |
| Élan                    | +8 % de vitesse des balles (plafonné).           |
| Balle supplémentaire    | Ajoute une balle (plafonné).                     |
| Éclats précieux         | +50 % de fragments par bloc brisé.               |

Chaque achat augmente le coût de l'amélioration selon un facteur `growth`, ce qui
maintient une progression exponentielle typique des clickers.

## Personnalisation rapide

- **Palette / thème** : variables CSS dans `:root` de `style.css`.
- **Couleurs des blocs** : `BLOCK_COLORS` dans `game.js`.
- **Équilibrage** : `baseCost` / `growth` des `UPGRADES`, PV des blocs dans `makeBlock`,
  récompense dans `breakBlock`.
- **Taille de la grille** : constante `target` dans `layoutGrid`.

## Conventions

- JavaScript « vanilla » (ES2020+), sans framework ni outil de build.
- Un seul fichier de logique ; garder les sections commentées et séparées.
- Rien ne doit bloquer le thread : tout passe par la boucle `requestAnimationFrame`.
