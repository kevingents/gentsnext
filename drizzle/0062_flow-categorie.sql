-- Flows categoriseren (Kevin, 13 aug 2026).
--
-- Met vier flows red je je met één lijst. Bij twintig niet meer, en dan is de
-- vraag "hebben we al iets voor terugwinnen?" niet meer te beantwoorden zonder
-- ze allemaal open te klikken.
--
-- Bewust een categorie op DOEL en niet op onderwerp. "Winkelwagen" en "Retour"
-- zijn onderwerpen; die groeien mee met elk nieuw idee en leveren over een jaar
-- vijftien categorieën met één flow. Op doel blijven het er vijf, en het dwingt
-- de vraag die telt: wat moet deze flow bereiken?
ALTER TABLE "email_flows" ADD COLUMN IF NOT EXISTS "categorie" text DEFAULT 'overig' NOT NULL;
CREATE INDEX IF NOT EXISTS "email_flows_categorie_idx" ON "email_flows" ("categorie");
