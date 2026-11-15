<p align="center">
  <img src="frontend/public/assets/logo.svg" alt="Cal-Home Alt" width="96">
</p>

<h1 align="center">Cal-Home Alt</h1>

<p align="center">
  Pilotez vos volets <strong>Calyps'HOME</strong> depuis votre ordinateur, sur votre réseau local : plan de la maison, volets par pièce,
  automatisations (heures fixes, lever/coucher du soleil, absence), notifications. Aucun compte en ligne, aucun cloud.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Statut : beta">
</p>

> [!WARNING]
> **Beta-test** : ce projet est en phase de test. Des bugs sont possibles et la configuration ou les données peuvent changer entre deux versions.
> Les retours sont bienvenus via les [issues](../../issues/new?template=beta-feedback.yml).

> ## ⚠️ Avertissement : projet indépendant, bénévole, sans garantie
>
> - **Aucun lien** avec **Calyps'HOME / Calypshome** ni avec **Profalux** (ni filiales, revendeurs, installateurs). Ce projet n'est ni créé, ni approuvé,
>   ni soutenu par eux. L'auteur n'a **aucune relation** commerciale ou professionnelle avec ces sociétés.
> - **Partagé gentiment et bénévolement**, par un particulier, **sans aucun intérêt financier** et **sans aucun service associé** (pas de support, pas
>   de mise à jour garantie).
> - **Aucune garantie** d'aucune sorte. **À vos risques et périls** : l'auteur **décline toute responsabilité** pour tout dommage (box ou volets
>   bloqués ou endommagés, perte de garantie du matériel, perte de données, blessure, cambriolage, etc.).
> - L'application utilise l'**API locale de la box, non officielle et non documentée** par le fabricant : elle peut cesser de fonctionner à tout moment.
> - **Ce n'est pas un dispositif de sécurité** : gardez toujours un moyen de commande manuel et vérifiez que rien ne gêne le passage d'un volet.
> - « Calyps'HOME », « Calypshome » et « Profalux » sont des marques de leurs propriétaires, citées à titre purement descriptif.
>
> 👉 Texte complet (français et anglais) : [DISCLAIMER.md](DISCLAIMER.md) · Crédits : [NOTICE.md](NOTICE.md).
> *English: independent, unofficial, volunteer, non-profit, no warranty, use at your own risk, not affiliated with Calyps'HOME or Profalux — see [DISCLAIMER.md](DISCLAIMER.md).*
> **En utilisant ce logiciel, vous acceptez ces conditions.**

## Fonctionnalités

- **Plan de la maison** : dessinez vos pièces, posez-y vos volets, pilotez-les d'un clic.
- **Volets** : ouvrir, fermer, arrêter, niveau précis, inclinaison des lames, raccourcis favoris, mode « soleil ».
- **Automatisations** : heures fixes, selon le soleil (lever / coucher, avec décalage), protection solaire par orientation de façade, mode absence.
- **Temps réel** : l'affichage suit l'état de la box sans rafraîchir la page.
- **Notifications** par e-mail (SMTP) si les volets restent ouverts tard.
- **Tout en local** : base SQLite, comptes locaux, rien n'est envoyé à un service extérieur.

## Démarrage rapide

Il vous faut **Python 3.10+** et **Node.js 20.19+** (la première fois seulement, pour construire l'interface).

```bash
git clone https://github.com/tibidibtibo/cal-home-alt.git
cd cal-home-alt
./start.sh               # Windows : start.bat (équivalent de : python run.py)
```

Le script crée l'environnement Python, installe les dépendances, construit l'interface, démarre le serveur et ouvre
`http://localhost:9050` dans votre navigateur. Le premier lancement prend quelques minutes ; les suivants quelques secondes.

Pour essayer sans box : `./start.sh --mock` (volets simulés).

### Première configuration

Au premier lancement, l'application vous guide :

1. **Votre compte** : choisissez un nom d'utilisateur et un mot de passe (stockés, hachés, sur votre ordinateur).
2. **L'assistant de configuration** :
   - le **nom de votre maison** ;
   - la **box** : son adresse IP (dans l'interface de votre routeur) et les identifiants de votre compte Calyps'HOME ;
   - votre **localisation** (latitude, longitude, fuseau) pour calculer lever et coucher du soleil ;
   - vos **pièces** ;
   - vos **volets** : détectés sur la box, vous leur donnez un nom, une pièce et l'orientation de la façade.
3. Les volets classés sont déjà posés sur le **plan** ; ajustez-le avec « Modifier le plan ».

Tout se modifie ensuite dans **Paramètres** (et l'assistant peut être relancé depuis « À propos »).

### Options de `run.py`

| Option | Effet |
|---|---|
| `--mock` | volets simulés, aucune commande envoyée à une vraie box |
| `--lan` | accessible depuis les autres appareils du réseau (téléphone, tablette). Par défaut, seul votre ordinateur y accède |
| `--port N` | change le port (défaut 9050) |
| `--dev` | développement : rechargement automatique (interface sur le port 9051) |
| `--rebuild` | reconstruit l'interface |
| `--no-browser` | n'ouvre pas le navigateur |

> **Sécurité** : avec `--lan`, toute personne de votre réseau peut atteindre la page de connexion. Choisissez un mot de passe solide
> et n'exposez jamais l'application directement sur Internet (pas de HTTPS intégré ; placez-la derrière un reverse proxy si besoin).

## Où sont mes données ?

Dans le dossier `data/` à la racine du projet : la base SQLite `calhome.db` (réglages, comptes, plan, automatisations) et les journaux.
Sauvegardez ce dossier pour tout conserver. `CALHOME_DATA_DIR` le déplace ; `CALHOME_DB_PATH` déplace seulement la base.
Le mot de passe de votre compte Calyps'HOME y est stocké **en clair** (la box exige ses identifiants pour chaque requête) : protégez ce dossier.

## Développement

```bash
python run.py --mock --dev          # backend (9050, rechargement) + interface Angular (9051)

.venv/bin/pytest                    # tests du backend (Windows : .venv\Scripts\pytest)
cd frontend && npm test             # tests de l'interface (Karma, Chrome requis)
```

- `backend/` : API FastAPI (`main.py`), lecture et commandes de la box (`state.py`, `api.py`, `mock_api.py`), planification (`scheduler.py`,
  `schedules_db.py`, `sun.py`), comptes (`auth.py`), SQLite (`database.py`).
- `frontend/src/app/` : interface Angular 21 ; composants d'interface maison dans `ui/`, styles globaux dans `src/styles.scss`
  (couleurs et thème clair/sombre : variables CSS en tête de fichier).
- `tests/` : tests pytest, avec `mock_box.py` qui simule la box.
- `docs/` : documentation de l'API de la box et note sur le [profil installateur](docs/installer-profile.md).
- `tools/` : outils en ligne de commande.

Variables d'environnement utiles : `CALYPS_MOCK=1` (volets simulés), `CALHOME_DATA_DIR`, `CALHOME_DB_PATH`, `BOX_MIN_REQUEST_INTERVAL`
(délai minimal entre deux requêtes vers la box, en secondes).

## Dépannage

- **« La box répond sur le réseau mais son serveur HTTP a coupé la connexion »** : le serveur web interne de la box est tombé alors qu'elle répond
  encore au ping. Redémarrez-la (débranchez-la 10 s). Si cela revient régulièrement, voir [docs/installer-profile.md](docs/installer-profile.md)
  (piste non confirmée).
- **Interface non construite** : lancez `python run.py` (ou `python run.py --rebuild`) ; Node.js 20.19 ou plus récent est nécessaire.
- **Port déjà utilisé** : `python run.py --port 9055`.
- **Mot de passe oublié** : arrêtez l'application puis supprimez les comptes (le reste est conservé) :
  `sqlite3 data/calhome.db "DELETE FROM users;"` (ou avec n'importe quel outil SQLite). Au prochain lancement, l'écran de création du compte réapparaît.

## Licence et crédits

Logiciel libre sous **licence MIT** — voir [LICENSE](LICENSE). Copyright (c) 2026 Thibault de Boissieu.
Vous pouvez l'utiliser, le modifier et le redistribuer librement, à condition de conserver la mention de copyright et la licence.

**Crédits** : le client de l'API de la box s'appuie sur le travail de **saniho** — [saniho/calypshome](https://github.com/saniho/calypshome),
l'intégration Home Assistant qui a découvert comment dialoguer avec la box. Merci à lui. Détails (et remarque sur la licence de ce projet) dans [NOTICE.md](NOTICE.md).
Si vous utilisez Home Assistant, c'est son intégration qu'il vous faut plutôt que Cal-Home Alt.

Ce projet est maintenu bénévolement : voir l'[avertissement](DISCLAIMER.md) avant toute utilisation.
