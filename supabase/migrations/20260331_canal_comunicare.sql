-- Adaugă canal preferat de comunicare pe tabelul programari
ALTER TABLE programari
  ADD COLUMN IF NOT EXISTS canal_comunicare TEXT DEFAULT 'email' CHECK (canal_comunicare IN ('email', 'whatsapp'));
