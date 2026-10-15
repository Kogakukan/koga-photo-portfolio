# Antoine — Photo Portfolio

Portfolio photo statique, minimaliste et gratuit, publié avec GitHub Pages.

Le principe :

- tu déposes tes JPEG édités dans `photos/` ;
- le script lit automatiquement les EXIF ;
- il crée les miniatures et les versions haute résolution avec filigrane ;
- il construit le catalogue par année, objectif et lieu ;
- GitHub Actions publie automatiquement le site.

Aucune base de données, aucun serveur, aucun abonnement.

## 1. Ajouter les photos

Utilise une seule catégorie de lieu directement sous l'année :

```text
photos/
└── 2026/
    ├── Japon/
    │   ├── photo-001.jpg
    │   └── photo-002.jpg
    └── Paris/
        └── photo-003.jpg
```

- Le premier dossier sous l'année est le lieu affiché : `Japon`, `Paris`, etc.
- L'année est prise depuis l'EXIF si elle existe, sinon depuis le dossier.
- La date originale de prise de vue est lue directement dans l'EXIF imbriqué du JPEG, comme dans les propriétés Windows.
- Les filtres par objectif utilisent l'objectif intégré au JPEG lorsqu'il est disponible.
- Les photos horizontales occupent deux colonnes et les portraits une colonne, sans recadrage.
- Aucun fichier XMP manuel n'est nécessaire.
- Les coordonnées GPS ne sont jamais affichées ni copiées dans le catalogue.
- Les noms de dossiers peuvent être en français et contenir des espaces ou des accents.

Pour ajouter un nouveau lieu, crée simplement un nouveau dossier :

```text
photos/2027/Islande/photo-004.jpg
```

Le lieu `Islande` apparaîtra automatiquement dans les filtres, les collections et la recherche après le prochain push GitHub. Aucun fichier de code ou catalogue n'a besoin d'être modifié.

## 2. Modifier le titre et le filigrane

Édite `config.json` :

```json
{
  "title": "Antoine",
  "tagline": "Photography as a way of seeing.",
  "subtitle": "Selected photographs",
  "watermark": "",
  "defaultView": "gallery"
}
```

## 3. Publier sur GitHub

1. Crée un nouveau dépôt GitHub, par exemple `antoine-photo-portfolio`.
2. Dépose tous les fichiers de ce projet dans le dépôt.
3. Ajoute tes photos dans `photos/`.
4. Va dans **Settings → Pages**.
5. Dans **Build and deployment**, choisis **GitHub Actions**.
6. Fais un commit/push sur la branche `main`.
7. L'action `.github/workflows/deploy.yml` construit et publie automatiquement le site.

L'adresse sera généralement :

```text
https://TON-PSEUDO.github.io/antoine-photo-portfolio/
```

## 4. Mise à jour ensuite

Pour ajouter des photos :

1. exporte tes JPEG depuis Lightroom ;
2. place-les dans le bon dossier sous `photos/` ;
3. fais un commit/push sur GitHub ;
4. attends la fin de l'action GitHub ;
5. le site est mis à jour automatiquement.

Tu n'as pas à modifier manuellement les dates, objectifs ou lieux. La date affichée est la date de prise de vue intégrée au JPEG, pas la date de modification du fichier Windows.

## Test local facultatif

Dans le dossier du projet :

```bash
python -m pip install -r requirements.txt
python build_catalog.py
python -m http.server 8000 --directory dist
```

Puis ouvre `http://localhost:8000`.

## Notes

- Les JPEG du portfolio sont recompressés en qualité 80 et limités à 5000 px sur le grand côté.
- Les miniatures sont limitées à 1400 px.
- Le zoom de la visionneuse est volontairement limité à 2×.
- Aucun filigrane n'est ajouté par défaut : les photos publiées restent propres.
- Si tu veux un jour un filigrane, renseigne `watermark` dans `config.json` ou exporte une version dédiée depuis Lightroom.
- Le dossier `dist/` est généré automatiquement et ne doit pas être modifié à la main.
- KDrive reste ton archive principale : ce projet ne remplace pas tes RAW, XMP ou ACR.
