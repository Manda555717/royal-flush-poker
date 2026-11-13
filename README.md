# Royal Flush — démo multijoueur locale

Prototype de Texas Hold'em multijoueur utilisant des jetons fictifs. Il comprend une page d'accueil, un lobby, une table et une fenêtre portefeuille de démonstration. Les dépôts/retraits réels ne sont pas activés.

## Important

Ouvrir `public/index.html` directement comme un fichier affiche le client, mais ne démarre pas le serveur multijoueur. La connexion entre joueurs nécessite Node.js et le serveur `server.js`.

## Démarrage sur ordinateur

1. Installer Node.js depuis https://nodejs.org/ (version LTS).
2. Télécharger le dépôt comme ZIP et décompresser le dossier.
3. Ouvrir un terminal dans le dossier du projet.
4. Exécuter `npm install`, puis `npm start`.
5. Ouvrir http://localhost:3000 dans le navigateur.
6. Ouvrir cette même adresse dans deux onglets et choisir un pseudo différent dans chaque onglet pour tester à deux.

Pour jouer depuis un autre appareil sur le même Wi-Fi, ouvrez dans ce navigateur l'adresse IP locale de l'ordinateur suivie de `:3000`. Le pare-feu de l'ordinateur peut demander l'autorisation.

Cette démo est destinée aux tests locaux. Elle n'inclut ni comptes sécurisés, ni bots, ni paiements, ni dépôt/retrait d'argent réel.
