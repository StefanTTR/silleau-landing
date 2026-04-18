-- Layout custom pentru elementele din header (logo, nume clinică, slogan, titlu, subtitlu).
-- Aplicat global pe toate paginile unde există elementele respective. Pe mobil, fallback la default.
-- JSON shape:
--   {
--     "logo":          {"x": 0, "y": 0, "w": 120, "h": 40},
--     "clinic-name":   {"x": 0, "y": 50},
--     "clinic-slogan": {"x": 0, "y": 90},
--     "main-title":    {"x": 0, "y": 130},
--     "sub":           {"x": 0, "y": 220}
--   }
-- Coordonate relative la colțul stânga-sus al .hdr în px.
ALTER TABLE clinic_branding
  ADD COLUMN IF NOT EXISTS layout jsonb DEFAULT '{}'::jsonb;
