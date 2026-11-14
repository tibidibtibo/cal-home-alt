# Crédits et avis / Credits and notices

## Projet d'origine / Original project

Le client de l'API HTTP locale de la box (`backend/api.py` : cookies d'authentification, appels `/m?a=getObjects` et `/m?a=command`,
actions `OPEN` / `CLOSE` / `STOP` / `LEVEL` / `TILT`) s'appuie sur le travail de **saniho** :

> **saniho/calypshome** — intégration Home Assistant pour Calyps'HOME
> <https://github.com/saniho/calypshome>

Sans ce travail de découverte et de documentation de l'API de la box, ce projet n'existerait pas : un grand merci à son auteur.

*The box API client (`backend/api.py`) builds on the work of **saniho** (<https://github.com/saniho/calypshome>), who first worked out how to talk to the box
locally. Many thanks.*

**Licence du projet d'origine.** Le README de `saniho/calypshome` indique une licence MIT ; son fichier `LICENSE` est toutefois vide (aucun texte ni titulaire
de droits n'y figure) et GitHub ne détecte aucune licence. À la connaissance du mainteneur, ce dépôt n'inclut pas de fichier copié tel quel de ce projet (le client a été réécrit), mais il en reprend le principe de
fonctionnement ; le mainteneur de Cal-Home Alt l'indique ici par transparence et par respect pour son auteur. Si l'auteur d'origine préfère un autre
crédit ou une autre mention, il peut le demander en ouvrant une issue.

*The upstream README states an MIT license, but its `LICENSE` file is empty and GitHub detects no license. To the maintainer's knowledge no upstream source file is copied verbatim (the client was rewritten);
the approach is reused, and credited here out of transparency and respect.*

## Ce projet / This project

Cal-Home Alt est publié sous licence MIT (voir [LICENSE](LICENSE)). Copyright (c) 2026 Thibault de Boissieu.

## Composants tiers / Third-party components

Les dépendances (FastAPI, Angular, Font Awesome Free, etc.) restent soumises à leurs propres licences, indiquées dans leurs paquets
(`backend/requirements.txt`, `frontend/package.json`). Les icônes Font Awesome Free sont sous licence CC BY 4.0, les polices sous SIL OFL 1.1 et le code sous MIT
(<https://fontawesome.com/license/free>).

## Marques / Trademarks

« Calyps'HOME », « Calypshome » et « Profalux » sont des marques de leurs propriétaires respectifs. Elles ne sont citées ici qu'à titre purement
descriptif, pour indiquer le matériel avec lequel ce logiciel peut dialoguer. Ce projet n'est ni affilié, ni approuvé, ni soutenu par ces sociétés.

*"Calyps'HOME", "Calypshome" and "Profalux" are trademarks of their respective owners, used here for identification only.*
