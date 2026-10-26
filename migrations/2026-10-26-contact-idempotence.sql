-- Demandes de devis : clé anti-doublon, référence, détails de la demande et suivi des reprises d'email.
-- NB : le Worker applique ces colonnes tout seul au premier envoi (ensureContactSchema) ; ce fichier sert de
-- référence et permet de les créer à l'avance. À NE PAS exécuter sur la production avant la revue.
ALTER TABLE contact_requests ADD COLUMN cle TEXT;
ALTER TABLE contact_requests ADD COLUMN reference TEXT;
ALTER TABLE contact_requests ADD COLUMN artiste TEXT;
ALTER TABLE contact_requests ADD COLUMN artiste_nom TEXT;
ALTER TABLE contact_requests ADD COLUMN organisme TEXT;
ALTER TABLE contact_requests ADD COLUMN type_evenement TEXT;
ALTER TABLE contact_requests ADD COLUMN jauge TEXT;
ALTER TABLE contact_requests ADD COLUMN budget TEXT;
ALTER TABLE contact_requests ADD COLUMN technique TEXT;
ALTER TABLE contact_requests ADD COLUMN lang TEXT;
ALTER TABLE contact_requests ADD COLUMN mail_tentatives INTEGER DEFAULT 0;
ALTER TABLE contact_requests ADD COLUMN mail_derniere TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_requests_cle ON contact_requests(cle) WHERE cle IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_requests_mail ON contact_requests(mail_envoye, id);
