# Box Calyps'HOME : coupures HTTP et profil installateur vide

> ⚠️ Projet indépendant, non affilié à Calyps'HOME ni à Profalux ; aucune garantie, à vos risques et périls — voir [DISCLAIMER.md](../DISCLAIMER.md).
> Modifier une donnée dans la box peut être considéré comme non autorisé par le fabricant (risque de perte de garantie).
>
> Statut : **hypothèse non confirmée**. Le correctif ci-dessous a été appliqué sur une box, mais son effet sur la stabilité n'est pas encore démontré.
> L'opération est réversible (voir « Retour arrière »).

## Symptôme

Le serveur HTTP local de la box (port 80, utilisé par l'appli et par l'intégration Home Assistant
[saniho/calypshome](https://github.com/saniho/calypshome)) cesse de répondre pendant des heures :

- `Remote end closed connection without response`, puis en continu `Connection reset by peer` ;
- parfois `Connection refused` ;
- la box répond encore au ping, et l'appli officielle / Google Home continuent de fonctionner (ils passent par le cloud du constructeur, pas par ce serveur local) ;
- un redémarrage de la box (débrancher 10 s) répare, jusqu'à la panne suivante.

Mêmes symptômes dans les issues [#3](https://github.com/saniho/calypshome/issues/3) et [#4](https://github.com/saniho/calypshome/issues/4) du dépôt `saniho/calypshome`.

## Ce qui a été éliminé

| Hypothèse | Verdict | Preuve |
|---|---|---|
| L'appli spamme la box | Non | Toutes les requêtes passent par `box_tracker` : une seule à la fois, ≥ 1 s d'écart, 5 s après un échec (`backend/api.py`). Charge réelle : 1 lecture toutes les 5 min. |
| Blacklist de l'IP du serveur | Non | Un autre poste du réseau, qui n'avait jamais contacté la box, subit le même reset (TCP accepté, puis fermeture dès la première requête). |
| Connexions bloquées côté serveur | Non | `ss` : aucune connexion résiduelle vers la box. |
| Notre client HTTP | Non | Mêmes appels (`POST /m?a=getObjects`, `/m?a=command`, mêmes cookies) que le code upstream, qui est plus agressif. |

## Cause probable : `installDate` vide

L'interface web de la box (`js/app.js`) appelle `getInstallerProfile`. Si `installDate` est vide, elle redirige vers l'assistant d'installation
(`/#/onboarding/`) : la box se considère comme **non installée**. L'issue #3 rapporte que remplir ce profil a stabilisé la connexion.
Le mécanisme exact (pourquoi un profil vide dégrade le serveur HTTP) n'est pas connu : c'est une corrélation, pas une cause démontrée.

Sur une box concernée, avant correction :

```json
{"lastName":"","companyName":"","companyPhone":"","firstName":"","email":"","installDate":""}
```

### Pourquoi ne pas utiliser l'assistant

L'assistant (`OnboardingInstallCtrl`) est l'installation de la **passerelle Zigbee** : l'étape 2 « Recherche réseau » cherche des réseaux Zigbee et en
trouve 0 (« RECHERCHE RÉSEAU (0) »), ce qui bloque l'accès au formulaire installateur. Il ne faut **pas** forcer la suite : elle pourrait recréer le
réseau et faire perdre l'appairage des volets. Le formulaire n'écrit en réalité que le profil installateur ; on l'écrit donc directement.

## API (tirée du JS de la box, `js/app_services.js`)

Deux appels, **sans authentification**, `POST` en `application/x-www-form-urlencoded` :

| Appel | Rôle |
|---|---|
| `POST /gw?a=getInstallerProfile` | Lit le profil (JSON : `firstName`, `lastName`, `companyName`, `companyPhone`, `email`, `installDate`). Lecture seule. |
| `POST /gw?a=setInstallerProfile` | Écrit le profil (mêmes champs en formulaire). Répond `200`. `installDate` est un horodatage ISO 8601 UTC (`2026-11-14T14:16:27.000Z`). |

Retour arrière : `setInstallerProfile` avec `installDate=` vide (c'est ce que fait la fonction `cleanInstallDate` de l'assistant).

```bash
# lire
curl -s --noproxy '*' -X POST -d '' 'http://192.168.1.50/gw?a=getInstallerProfile'

# écrire
curl -s --noproxy '*' -X POST \
  --data-urlencode 'firstName=Particulier' --data-urlencode 'lastName=Cal-Home Alt' \
  --data-urlencode 'companyName=Particulier' --data-urlencode 'companyPhone=' --data-urlencode 'email=' \
  --data-urlencode "installDate=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  'http://192.168.1.50/gw?a=setInstallerProfile'
```

> ⚠️ **Ne jamais envoyer `Connection: close`** à la box. Son serveur (libwebsockets, HTTP/1.0) ferme alors le socket avant d'avoir écrit la réponse
> (`Remote end closed connection without response`). C'est déjà noté dans `backend/api.py`. Piège réel : `urllib.request` ajoute cet en-tête
> automatiquement, d'où l'usage de `http.client` dans le script ; `curl` et `requests` n'ont pas ce défaut.

## Script

[`tools/calyps_installer_profile.py`](../tools/calyps_installer_profile.py) — Python ≥ 3.8, bibliothèque standard uniquement.

```bash
# 1. Voir le profil actuel (lecture seule)
python3 tools/calyps_installer_profile.py --host 192.168.1.50 --show

# 2. Préparer le JSON (modèle : tools/calyps_installer_profile.example.json)
cat > profile.json <<'EOF'
{"firstName": "Particulier", "lastName": "Cal-Home Alt", "companyName": "Particulier", "companyPhone": "", "email": "", "installDate": ""}
EOF

# 3. Voir ce qui serait envoyé, puis écrire
python3 tools/calyps_installer_profile.py --host 192.168.1.50 --profile profile.json --dry-run
python3 tools/calyps_installer_profile.py --host 192.168.1.50 --profile profile.json

# Retour arrière
python3 tools/calyps_installer_profile.py --host 192.168.1.50 --reset
```

Comportement :

- Tous les champs du JSON sont optionnels ; `installDate` vaut « maintenant » s'il est vide ou absent. Un champ inconnu est refusé.
- Si le profil de la box est **déjà renseigné**, le script ne fait rien (sauf `--force`).
- Après écriture, il **relit** le profil et compare : code retour `0` si identique, `2` s'il diffère, `1` si la box est injoignable.
- Trois secondes de pause entre appels : la box est fragile, pas de rafale.
- Pas de données personnelles nécessaires : le profil est stocké sur la box (et peut être remonté à son cloud). Des valeurs neutres suffisent.

Si le script échoue avec `Connection reset` / `refused`, la box est déjà dans l'état de panne : la redémarrer (débrancher 10 s) **puis** lancer le script.
