-- Billetterie et tarif d'un événement public (repris dans les données structurées JSON-LD).
-- Le worker ajoute ces colonnes tout seul au premier appel d'API (ensureEventSchema) ;
-- ce fichier sert uniquement de trace si on veut le faire à la main.
ALTER TABLE actualites ADD COLUMN ticket_url TEXT;
ALTER TABLE actualites ADD COLUMN ticket_price TEXT;
