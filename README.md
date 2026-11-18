# Cagnotte virtuelle

Petite webapp (FastAPI + HTML/JS sans build) pour gérer une cagnotte partagée. Données en CSV, sans authentification (réseau local uniquement).

## Règles
- **Rentrée d'argent** : la cagnotte augmente, la dette de l'utilisateur choisi augmente du même montant.
- **Dépense** : la dette de l'utilisateur est réduite d'abord ; ce qui dépasse (ou tout, s'il n'a pas de dette) est réparti en dette à parts égales entre les autres utilisateurs.
- **Cagnotte = somme des dettes de tous les utilisateurs.** Elle baisse de la dette effacée et augmente des dettes ajoutées aux autres.

Cette logique est dans `compute_effects` ([app/main.py](app/main.py)).

## Dev local (WSL)
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Ouvrir http://localhost:8000 — les données sont dans `./data/`.

## Données
- `operations.csv` : id, date, type, utilisateur, montant, description, effets sur les dettes, date de saisie
- `utilisateurs.csv` : un nom par ligne

Séparateur `;`, encodage UTF-8 avec BOM (ouverture directe dans Excel). Téléchargeables depuis la page.

## Déploiement (GitHub + Dockge)
1. Pousser sur GitHub (branche `main`) : le workflow `.github/workflows/docker.yml` publie l'image sur `ghcr.io/<user>/cagnottevirtuelle:latest`.
2. Rendre le package public (GitHub → Packages → Settings), ou configurer un login ghcr dans Docker sur le TrueNAS.
3. Dans Dockge, créer une stack avec le contenu de `compose.yaml` (en remplaçant `VOTRE_USER_GITHUB`). Le dossier `./data` de la stack contient les CSV (pensez à le sauvegarder).
4. Accès : `http://<ip-truenas>:8080`.
