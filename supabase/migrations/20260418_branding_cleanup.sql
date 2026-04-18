-- Curăță schema de design după consolidarea în clinic_branding:
--   1) redenumește nome_afisat (IT typo) → nume_afisat (RO)
--   2) elimină coloanele de branding duplicate din clinici
--   3) creează bucketul Storage `clinic-logos` + policies pentru logo/favicon

-- 1) Rename coloană displayed name
ALTER TABLE clinic_branding RENAME COLUMN nome_afisat TO nume_afisat;

-- 2) Drop coloane duplicate din clinici (există deja în clinic_branding)
ALTER TABLE clinici
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS tema,
  DROP COLUMN IF EXISTS tema_draft,
  DROP COLUMN IF EXISTS approval_token,
  DROP COLUMN IF EXISTS modificari_luna,
  DROP COLUMN IF EXISTS reset_modificari_date;

-- 3) Storage bucket pentru logo + favicon (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clinic-logos',
  'clinic-logos',
  true,
  2097152, -- 2 MB
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'image/webp',
    'image/x-icon',
    'image/vnd.microsoft.icon'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public              = EXCLUDED.public,
  file_size_limit     = EXCLUDED.file_size_limit,
  allowed_mime_types  = EXCLUDED.allowed_mime_types;

-- 4) Policies storage.objects pentru bucketul clinic-logos
DROP POLICY IF EXISTS "clinic_logos_public_read"    ON storage.objects;
DROP POLICY IF EXISTS "clinic_logos_service_write"  ON storage.objects;

CREATE POLICY "clinic_logos_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'clinic-logos');

CREATE POLICY "clinic_logos_service_write"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'clinic-logos')
  WITH CHECK (bucket_id = 'clinic-logos');
