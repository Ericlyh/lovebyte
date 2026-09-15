import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/media/[mediaId] — public URL for a gift_media row.
 *
 * Returns { url: string } for the given mediaId.
 * Used by the publish card's cover media picker to render thumbnails.
 *
 * Auth: requires authenticated user (to prevent enumeration of other users' media).
 * RLS on gift_media table enforces ownership.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  const { mediaId } = await params;

  if (!mediaId || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
    return NextResponse.json({ error: 'Invalid mediaId.' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { data: media, error } = await supabase
    .from('gift_media')
    .select('storage_path')
    .eq('id', mediaId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (error || !media) {
    return NextResponse.json({ error: 'Media not found.' }, { status: 404 });
  }

  const { data: urlData } = supabase.storage
    .from('lovebyte-media')
    .getPublicUrl(media.storage_path);

  return NextResponse.json({ url: urlData.publicUrl });
}
