#!/usr/bin/env python3
"""Lance Cal-Home Alt sur votre ordinateur (Linux, macOS, Windows) : python run.py

Au premier lancement, le script prépare tout seul l'environnement Python (.venv), installe les dépendances,
construit l'interface web (Node.js 20.19+ requis), démarre le serveur et ouvre le navigateur.

Options :
  --mock          volets simulés, sans box (pour essayer l'application)
  --lan           accessible depuis les autres appareils du réseau (téléphone…) ; par défaut, seul cet ordinateur y accède
  --port N        port du serveur (défaut : 9050)
  --dev           mode développement : rechargement automatique (serveur Angular sur le port 9051)
  --rebuild       reconstruit l'interface même si elle semble à jour
  --no-browser    n'ouvre pas le navigateur
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
DIST = FRONTEND / "dist" / "cal-home-alt-frontend" / "browser"
VENV = ROOT / ".venv"
VENV_PY = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
MIN_PYTHON = (3, 10)


def say(msg: str) -> None:
    print(f"[cal-home-alt] {msg}", flush=True)


def die(msg: str) -> "None":
    print(f"\n[cal-home-alt] ERREUR : {msg}\n", file=sys.stderr)
    sys.exit(1)


def run(cmd: list[str], cwd: Path = ROOT, **kw) -> None:
    try:
        subprocess.run(cmd, cwd=cwd, check=True, **kw)
    except subprocess.CalledProcessError as e:
        die(f"la commande a échoué : {' '.join(map(str, cmd))} (code {e.returncode})")
    except FileNotFoundError:
        die(f"commande introuvable : {cmd[0]}")


def ensure_venv() -> None:
    if VENV_PY.exists() and subprocess.run([str(VENV_PY), "--version"], capture_output=True).returncode != 0:
        say("environnement Python inutilisable (dossier déplacé ?) — recréation…")
        shutil.rmtree(VENV, ignore_errors=True)
    if not VENV_PY.exists():
        say("création de l'environnement Python (.venv)…")
        run([sys.executable, "-m", "venv", str(VENV)])
    req = ROOT / "backend" / "requirements.txt"
    stamp = VENV / ".requirements.sha256"
    digest = hashlib.sha256(req.read_bytes()).hexdigest()
    if not stamp.exists() or stamp.read_text() != digest:
        say("installation des dépendances Python…")
        run([str(VENV_PY), "-m", "pip", "install", "-q", "--disable-pip-version-check", "-r", str(req)])
        stamp.write_text(digest)


def npm_cmd() -> str:
    npm = shutil.which("npm")
    if not npm:
        die("Node.js (avec npm) est requis pour construire l'interface : https://nodejs.org (version 20.19 ou plus récente).")
    return npm


def check_node() -> None:
    node = shutil.which("node")
    if not node:
        npm_cmd()
    try:
        version = subprocess.run([node or "node", "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
        major, minor = (int(x) for x in version.split(".")[:2])
    except (ValueError, OSError):
        return
    if (major, minor) < (20, 19):
        die(f"Node.js {version} est trop ancien : l'interface demande la version 20.19 ou plus récente (https://nodejs.org).")


def npm_install() -> None:
    if not (FRONTEND / "node_modules").exists():
        say("installation des dépendances de l'interface (npm install, quelques minutes la première fois)…")
        run([npm_cmd(), "install", "--no-audit", "--no-fund"], cwd=FRONTEND)


def newest_source_mtime() -> float:
    newest = 0.0
    for path in [FRONTEND / "package.json", FRONTEND / "angular.json", *(FRONTEND / "src").rglob("*"), *(FRONTEND / "public").rglob("*")]:
        if path.is_file():
            newest = max(newest, path.stat().st_mtime)
    return newest


def ensure_frontend_build(force: bool) -> None:
    index = DIST / "index.html"
    if not force and index.exists() and index.stat().st_mtime >= newest_source_mtime():
        return
    check_node()
    npm_install()
    say("construction de l'interface web…")
    run([npm_cmd(), "run", "build"], cwd=FRONTEND)


def port_free(port: int) -> bool:
    """Libre = personne n'écoute sur ce port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", port)) != 0


def lan_address() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))   # aucune donnée envoyée : sert à connaître l'interface réseau par défaut
            return s.getsockname()[0]
    except OSError:
        return "l'adresse IP de cet ordinateur"


def open_browser_when_ready(url: str, check_url: str) -> None:
    for _ in range(120):
        try:
            urllib.request.urlopen(check_url, timeout=1)
            webbrowser.open(url)
            return
        except OSError:
            time.sleep(0.5)


def main() -> None:
    ap = argparse.ArgumentParser(description="Lance Cal-Home Alt.", formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--mock", action="store_true", help="volets simulés (sans box)")
    ap.add_argument("--lan", action="store_true", help="accessible depuis le réseau local")
    ap.add_argument("--port", type=int, default=9050)
    ap.add_argument("--dev", action="store_true", help="mode développement (rechargement automatique)")
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    if sys.version_info < MIN_PYTHON:
        die(f"Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} ou plus récent est requis (vous avez {sys.version.split()[0]}).")

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    ports = [args.port] + ([9051] if args.dev else [])
    for p in ports:
        if not port_free(p):
            die(f"le port {p} est déjà utilisé (Cal-Home Alt tourne-t-il déjà ?). Choisissez-en un autre avec --port.")

    ensure_venv()
    if args.dev:
        check_node()
        npm_install()
    else:
        ensure_frontend_build(args.rebuild)

    env = dict(os.environ)
    if args.mock:
        env["CALYPS_MOCK"] = "1"
        say("MODE SIMULATION : aucun ordre n'est envoyé à une vraie box.")

    cmd = [str(VENV_PY), "-m", "uvicorn", "backend.main:app", "--host", host, "--port", str(args.port)]
    if args.dev:
        cmd += ["--reload", "--reload-dir", "backend"]
    procs = [subprocess.Popen(cmd, cwd=ROOT, env=env)]
    if args.dev:
        procs.append(subprocess.Popen([npm_cmd(), "start", "--", "--host", host], cwd=FRONTEND, env=env))

    url = f"http://localhost:{9051 if args.dev else args.port}"
    say(f"Cal-Home Alt → {url}")
    if args.lan:
        say(f"Depuis un autre appareil du réseau : http://{lan_address()}:{9051 if args.dev else args.port}")
        say("Attention : toute personne de votre réseau peut atteindre la page de connexion. Protégez-la par un mot de passe solide.")
    say("Ctrl+C pour arrêter.")
    if not args.no_browser:
        threading.Thread(target=open_browser_when_ready, args=(url, f"http://127.0.0.1:{args.port}/api/auth/status"), daemon=True).start()

    try:
        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
        die("un des processus s'est arrêté (voir les messages ci-dessus).")
    except KeyboardInterrupt:
        print()
        say("arrêt…")
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    main()
