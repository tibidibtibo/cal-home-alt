# Avertissement important / Important disclaimer

**Lisez ceci avant d'utiliser Cal-Home Alt. En l'utilisant, vous acceptez ces conditions.**

## Français

1. **Projet indépendant et non officiel.** Cal-Home Alt n'a **aucun lien** avec **Calyps'HOME / Calypshome**, avec **Profalux**, ni avec leurs filiales, revendeurs ou
   installateurs. Il n'est ni créé, ni approuvé, ni soutenu, ni recommandé par eux. L'auteur n'a aucune relation commerciale, contractuelle ou
   professionnelle avec ces sociétés.
2. **Partagé bénévolement, sans but lucratif.** Ce logiciel est mis en ligne gratuitement, par un particulier, à titre de partage. L'auteur n'en tire
   **aucun revenu ni avantage financier** et n'offre **aucun service** : pas de support, pas de délai de réponse, pas de mise à jour garantie, pas de
   correction garantie. Les contributions et issues sont traitées quand l'auteur en a le temps et l'envie, ou pas du tout.
3. **Aucune garantie.** Le logiciel est fourni « tel quel », sans garantie d'aucune sorte, expresse ou implicite (qualité, adéquation à un usage, absence
   de bogue, sécurité, disponibilité, compatibilité avec votre matériel ou avec une version de firmware). Voir la [licence MIT](LICENSE).
4. **À vos risques et périls.** Vous êtes seul responsable de l'usage que vous en faites et de ses conséquences. L'auteur et les contributeurs **déclinent
   toute responsabilité**, dans toute la mesure permise par la loi, pour tout dommage direct ou indirect, notamment : dysfonctionnement, blocage ou
   panne de la box, des volets ou de leurs moteurs ; perte de configuration ou de données ; **perte de garantie** du matériel ; dégât matériel ;
   blessure ; cambriolage ou intrusion ; surconsommation d'énergie ; coupure de service ; fuite d'identifiants.
5. **Interface non documentée.** Le logiciel utilise l'API HTTP locale de la box, qui n'est ni officielle ni documentée par le fabricant et peut changer ou
   cesser de fonctionner à tout moment, par exemple après une mise à jour du firmware. Un usage trop intensif peut déstabiliser la box : le logiciel limite
   volontairement ses requêtes, mais rien ne garantit qu'il n'y aura aucun effet de bord.
6. **Écriture dans la box.** L'outil optionnel `tools/calyps_installer_profile.py` modifie une donnée enregistrée **dans la box**. Cette piste est une
   hypothèse, **non confirmée** ; elle peut ne rien corriger, et le fabricant peut la considérer comme une modification non autorisée. N'y recourez que
   si vous en acceptez les conséquences.
7. **Ce n'est pas un dispositif de sécurité.** N'utilisez pas Cal-Home Alt comme seule protection (anti-intrusion, anti-pincement, protection contre le vent,
   la pluie, le gel ou les incendies, ni pour des personnes vulnérables, des animaux ou des biens de valeur). Un volet qui bouge à distance ou
   automatiquement peut blesser ou coincer quelqu'un ou quelque chose : vérifiez ce qui se trouve dans le passage et gardez toujours un moyen de
   commande manuel.
8. **Sécurité et données personnelles.** Cal-Home Alt est conçu pour un réseau local de confiance. Il stocke sur **votre** ordinateur, dans `data/`, vos réglages et
   le mot de passe de votre compte Calyps'HOME (en clair, la box l'exigeant). Il n'envoie rien à l'auteur ni à un service tiers. Ne l'exposez jamais
   directement sur Internet. Vous êtes responsable de la protection de votre réseau, de votre ordinateur et de vos identifiants.
9. **Marques.** Les noms et marques cités appartiennent à leurs propriétaires et ne servent qu'à décrire la compatibilité. Voir [NOTICE.md](NOTICE.md).
10. **Contenus de tiers.** Ce projet s'appuie sur le travail d'autres personnes (voir [NOTICE.md](NOTICE.md)) ; l'auteur ne garantit pas leur exactitude.

Si vous n'acceptez pas ces conditions, n'utilisez pas ce logiciel.

## English

1. **Independent, unofficial project.** Cal-Home Alt has **no affiliation whatsoever** with **Calyps'HOME / Calypshome**, **Profalux**, or their subsidiaries, resellers
   or installers, and is not made, endorsed, supported or recommended by them. The author has no commercial or professional relationship with them.
2. **Shared voluntarily, non-profit.** Published free of charge by an individual, as a courtesy. The author earns **no income or financial benefit** from it
   and provides **no service**: no support, no response time, no guaranteed updates or fixes.
3. **No warranty.** Provided "as is", without warranty of any kind, express or implied (quality, fitness for a purpose, absence of bugs, security,
   availability, compatibility with your hardware or firmware). See the [MIT license](LICENSE).
4. **Use at your own risk.** You alone are responsible for how you use it. To the fullest extent permitted by law, the author and contributors **disclaim all
   liability** for any direct or indirect damage, including malfunction, lock-up or failure of the box, shutters or motors; loss of settings or data; **loss of
   hardware warranty**; property damage; injury; burglary; excess energy use; service interruption; credential leaks.
5. **Undocumented interface.** The software uses the box's local HTTP API, which is neither official nor documented by the manufacturer and may change or stop
   working at any time (e.g. after a firmware update). The software rate-limits its requests on purpose, with no guarantee against side effects.
6. **Writing to the box.** The optional `tools/calyps_installer_profile.py` changes data stored **on the box**. It rests on an **unconfirmed** hypothesis, may fix
   nothing, and the manufacturer may regard it as unauthorized modification. Use it only if you accept the consequences.
7. **Not a safety device.** Do not rely on Cal-Home Alt as your only protection (intrusion, entrapment, wind/rain/frost/fire protection, vulnerable people, animals
   or valuables). Moving shutters remotely or automatically can injure or trap someone or something: check the area and always keep manual control.
8. **Security and privacy.** Designed for a trusted local network. It stores your settings and your Calyps'HOME account password (in clear text, as the box requires it)
   on **your** computer in `data/`. Nothing is sent to the author or any third party. Never expose it directly to the Internet.
9. **Trademarks.** Names and marks belong to their owners and are used for identification only. See [NOTICE.md](NOTICE.md).
10. **Third-party work.** This project builds on others' work (see [NOTICE.md](NOTICE.md)); the author does not warrant its accuracy.

If you do not agree, do not use this software.
