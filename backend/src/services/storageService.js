const { createClient } = require('@supabase/supabase-js');

let supabase = null;

const getClient = () => {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    supabase = createClient(url, key);
  }
  return supabase;
};

const BUCKET = 'pitchdecks';

/**
 * Upload a PDF buffer to Supabase Storage.
 * Returns the public URL.
 */
const uploadPdf = async (filename, buffer) => {
  const client = getClient();
  const { error } = await client.storage
    .from(BUCKET)
    .upload(filename, buffer, { contentType: 'application/pdf', upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = client.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
};

module.exports = { uploadPdf };
