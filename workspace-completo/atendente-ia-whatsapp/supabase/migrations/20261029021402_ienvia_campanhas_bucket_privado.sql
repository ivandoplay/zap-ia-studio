INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('ienvia-campanhas-privadas', 'ienvia-campanhas-privadas', false, 36700160) ON CONFLICT (id) DO NOTHING;
