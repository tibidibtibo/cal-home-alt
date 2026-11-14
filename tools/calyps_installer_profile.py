#!/usr/bin/env python3
"""Lit / renseigne le « profil installateur » d'une box Calyps'HOME (voir docs/installer-profile.md).

Une box dont `installDate` est vide se croit « non installée » : son serveur HTTP local finit par couper toutes les connexions
(`Connection reset by peer`, `Remote end closed connection`). Renseigner le profil corrige ce cas.

    python3 tools/calyps_installer_profile.py --host 192.168.1.50 --show
    python3 tools/calyps_installer_profile.py --host 192.168.1.50 --profile profile.json --dry-run
    python3 tools/calyps_installer_profile.py --host 192.168.1.50 --profile profile.json
    python3 tools/calyps_installer_profile.py --host 192.168.1.50 --reset        # remet installDate à vide (retour arrière)

Fichier JSON attendu (tous les champs sont optionnels ; `installDate` vaut « maintenant » s'il est absent) :

    {"firstName": "Prénom", "lastName": "Nom", "companyName": "Société", "companyPhone": "", "email": "", "installDate": ""}

AVERTISSEMENT : outil indépendant, non affilié à Calyps'HOME ni à Profalux, fourni sans aucune garantie et à vos risques et périls (voir DISCLAIMER.md).
Il écrit une donnée DANS la box ; l'hypothèse qu'il repose sur n'est pas confirmée et le fabricant peut y voir une modification non autorisée.

Bibliothèque standard uniquement (Python ≥ 3.8). Aucun identifiant n'est nécessaire : ces deux appels sont ouverts sur le réseau local.
"""
from __future__ import annotations

import argparse
import http.client
import json
import sys
import time
import urllib.parse
from datetime import datetime, timezone

FIELDS = ("firstName", "lastName", "companyName", "companyPhone", "email", "installDate")
TEXT_FIELDS = FIELDS[:-1]
# La box est fragile : on ne lui envoie jamais de rafale. Pause entre deux appels consécutifs (secondes).
PAUSE = 3.0
TIMEOUT = 10.0


class BoxError(Exception):
    pass


def _post(host: str, action: str, data: dict[str, str] | None = None) -> str:
    """POST sur `/gw?a=<action>`. http.client (et non urllib) : urllib force `Connection: close`, ce qui fait couper la réponse par le serveur
    HTTP de la box (libwebsockets) avant qu'il l'ait écrite. Pas de proxy non plus : la box est sur le réseau local."""
    body = urllib.parse.urlencode(data or {})
    conn = http.client.HTTPConnection(host, 80, timeout=TIMEOUT)
    try:
        conn.request("POST", f"/gw?a={action}", body=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
        resp = conn.getresponse()
        text = resp.read().decode("utf-8", errors="replace")
        if resp.status != 200:
            raise BoxError(f"{action} : HTTP {resp.status}")
        return text
    except (http.client.HTTPException, OSError) as e:
        raise BoxError(
            f"{action} : {e}. Si c'est « Connection reset » / « refused » : la box doit d'abord être redémarrée (débrancher 10 s)."
        ) from e
    finally:
        conn.close()


def get_profile(host: str) -> dict[str, str]:
    raw = _post(host, "getInstallerProfile")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise BoxError(f"getInstallerProfile : réponse non JSON ({raw[:120]!r})") from e
    if not isinstance(data, dict):
        raise BoxError(f"getInstallerProfile : réponse inattendue ({raw[:120]!r})")
    return {k: str(data.get(k, "") or "") for k in FIELDS}


def set_profile(host: str, profile: dict[str, str]) -> None:
    _post(host, "setInstallerProfile", profile)


def now_iso() -> str:
    """Même format que le navigateur (Date → ISO 8601 UTC, millisecondes)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def load_profile(path: str) -> dict[str, str]:
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise SystemExit(f"Fichier de profil illisible : {e}")
    if not isinstance(raw, dict):
        raise SystemExit("Le fichier de profil doit contenir un objet JSON.")
    unknown = sorted(set(raw) - set(FIELDS))
    if unknown:
        raise SystemExit(f"Champs inconnus : {', '.join(unknown)} (attendus : {', '.join(FIELDS)})")
    profile = {k: str(raw.get(k, "") or "").strip() for k in FIELDS}
    if not profile["installDate"]:
        profile["installDate"] = now_iso()
    if not any(profile[k] for k in TEXT_FIELDS):
        # La box accepte des champs vides ; on met une valeur neutre pour que le profil ne ressemble pas à « non renseigné ».
        profile["companyName"] = "Particulier"
    return profile


def show(label: str, profile: dict[str, str]) -> None:
    print(f"{label} :")
    for k in FIELDS:
        print(f"  {k:<13} = {profile[k]!r}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--host", required=True, help="IP (ou nom) de la box, ex. 192.168.1.50")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--show", action="store_true", help="affiche le profil actuel et quitte (lecture seule)")
    mode.add_argument("--profile", metavar="FICHIER.json", help="profil à écrire")
    mode.add_argument("--reset", action="store_true", help="vide installDate (retour arrière : la box redemandera l'installation)")
    ap.add_argument("--dry-run", action="store_true", help="n'écrit rien : affiche ce qui serait envoyé")
    ap.add_argument("--force", action="store_true", help="écrase un profil déjà renseigné (refusé par défaut)")
    args = ap.parse_args()

    try:
        current = get_profile(args.host)
        show("Profil actuel", current)
        if args.show:
            print("\n→ installDate vide : la box se croit non installée." if not current["installDate"] else "\n→ profil déjà renseigné.")
            return 0

        if args.reset:
            new = {k: current[k] for k in FIELDS}
            new["installDate"] = ""
        else:
            if current["installDate"] and not args.force:
                print("\nProfil déjà renseigné : rien à faire (utiliser --force pour l'écraser).")
                return 0
            new = load_profile(args.profile)

        print()
        show("À écrire", new)
        if args.dry_run:
            print("\n(dry-run : rien n'a été envoyé)")
            return 0

        time.sleep(PAUSE)
        set_profile(args.host, new)
        time.sleep(PAUSE)
        after = get_profile(args.host)
        print()
        show("Profil relu", after)
        ok = after["installDate"] == new["installDate"] and all(after[k] == new[k] for k in TEXT_FIELDS)
        print("\n✅ Profil enregistré." if ok else "\n⚠️  La box a répondu, mais le profil relu diffère de celui envoyé.")
        return 0 if ok else 2
    except BoxError as e:
        print(f"❌ {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
