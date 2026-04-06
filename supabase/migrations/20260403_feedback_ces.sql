-- Feedback Customer Effort Score (1-5) colectat prin WhatsApp
ALTER TABLE programari
  ADD COLUMN IF NOT EXISTS feedback_ces SMALLINT CHECK (feedback_ces BETWEEN 1 AND 5);
