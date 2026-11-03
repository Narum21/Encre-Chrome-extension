# Encre : écrire au stylet sur le web

Extension Chrome pour écrire, surligner et effacer au stylet sur n'importe quelle page.
Le bouton latéral du stylet sert de gomme, quel que soit l'outil sélectionné.

## Installation (2 minutes)

1. Décompresse `encre.zip`. Tu obtiens un dossier `encre`.
2. Dans Chrome, ouvre `chrome://extensions`.
3. Active le **Mode développeur** (interrupteur en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `encre`.
5. Clique sur l'icône puzzle de la barre Chrome, puis sur l'épingle à côté d'**Encre**.

Garde le dossier `encre` à sa place : Chrome le lit à chaque démarrage.

## Utilisation

- **Activer ou masquer** : clic sur l'icône Encre, ou `Alt+Maj+D`.
- **Écrire** : pose le stylet. L'épaisseur suit la pression.
- **Effacer avec le stylet** : maintiens le bouton latéral et passe sur le trait.
  En survol (pointe levée), un cercle montre la gomme sans rien effacer.
  Le bout gomme (Surface Pen, certains Wacom) efface aussi.
- **Doigt** : il n'écrit jamais. Il clique, fait défiler et zoome sur la page comme d'habitude,
  même quand Encre est active.
- **Paume** : tant que le stylet survole l'écran, Encre ignore les contacts au doigt.
  Ils remarchent dès que tu éloignes le stylet, au plus tard 3 secondes après.
- **Souris** : clic gauche pour écrire, clic droit maintenu pour effacer. Pour cliquer à la souris, passe en mode Naviguer.

| Outil | Rôle | Touche |
|---|---|---|
| Stylo | Écrire, 4 couleurs, 3 épaisseurs | P |
| Surligneur | Surligner en transparence | S |
| Gomme | **Trait** efface le trait entier, **Zone** seulement la partie touchée | E |
| Naviguer | Le stylet et la souris cliquent aussi sur la page (le doigt clique toujours) | N |

Autres raccourcis : `Ctrl+Z` annuler, `Ctrl+Y` rétablir, `Échap` masquer.
En mode Naviguer, le clavier est laissé à la page.

**Zoom** : zoome à deux doigts sur l'écran ou sur le pavé tactile. L'encre est redessinée
à chaque zoom : elle reste aussi nette que le texte et collée au même endroit de la page.
La barre garde sa taille et reste à l'écran.

La barre se déplace par sa poignée (les trois rangées de points en haut).
L'appareil photo enregistre une capture de l'écran annoté dans tes téléchargements.

Tes traits sont enregistrés sur cet ordinateur, page par page. Ils réapparaissent
quand tu réactives Encre sur la même adresse.

## Si le bouton du stylet n'efface pas

Encre reconnaît le bouton latéral quand Chrome le voit comme un **clic droit**
ou comme une **gomme**. C'est le réglage par défaut sur la plupart des stylets Windows.
Si ton bouton lance autre chose (un raccourci, un menu, un double clic) :

- **Wacom, Huion, XP-Pen** : dans le logiciel de la tablette, règle le bouton latéral sur « Clic droit ».
- **Surface Pen** : le bouton du haut sert de raccourci système. Retourne le stylet et frotte avec le bout gomme.
- **Autres** : dans les paramètres du stylet de ton système, mets le bouton sur « Clic droit ».

## Limites connues

- Chrome bloque les extensions sur les pages `chrome://`, le Chrome Web Store et sa visionneuse PDF.
  L'icône affiche alors un « ! ».
- Sur les sites qui défilent à l'intérieur d'un cadre (Gmail, Google Docs, Notion…),
  les traits restent accrochés à la fenêtre et ne suivent pas ce cadre.
- Si la mise en page change (fenêtre redimensionnée, zoom Ctrl + molette), le texte peut bouger et les traits ne se recalent pas dessus. Le zoom à deux doigts n'a pas ce problème.
- Un stylet passif (embout en caoutchouc, sans pile ni Bluetooth) est vu comme un doigt : il ne peut pas écrire.
- Les extensions Chrome ne fonctionnent pas sur iPad ni sur téléphone.

## Permissions

- `activeTab` + `scripting` : Encre n'agit que sur l'onglet où tu l'actives, au moment où tu l'actives.
- `storage` + `unlimitedStorage` : enregistre tes traits et réglages sur ton ordinateur.

Aucune donnée n'est envoyée ailleurs.
