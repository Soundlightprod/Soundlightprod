-- Laser RVB 3W sur batterie : retire la ligne « Laser RVB 300mW-5W », qui contredit le titre (3W) et semble provenir
-- d'une autre variante fournisseur. À exécuter SEULEMENT après validation du propriétaire ; puis relancer _boutique/build.py.
-- Aucune valeur de remplacement n'est inventée : la puissance, la classe laser et l'autonomie sont à confirmer (modèle exact).
UPDATE products
   SET description = REPLACE(description, ' | Laser RVB 300mW-5W', '')
 WHERE slug = 'battery-3w-animated-laser-light';
