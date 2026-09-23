# Traductions EN / ES (soundlightprod.com)

Les pages anglaises (`/en/`) et espagnoles (`/es/`) sont générées à partir des pages françaises.

- `strings.json` : liste figée des textes français (l'index sert de clé)
- `en.py` / `es.py` : traductions, par index
- `build.py` : régénère `en/`, `es/` et ajoute sélecteur de langue + balises hreflang aux pages FR

Après modification d'une page française : `python3 _i18n/build.py`.
Si un texte français a changé, sa traduction ne s'applique plus (le texte reste en français
dans la version EN/ES) : ajouter la nouvelle phrase à `strings.json` puis sa traduction dans `en.py` / `es.py`.
