import { NextResponse } from 'next/server';
import { getPlatforms } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Fetch dynamic list of platforms from Supabase database
    const platforms = await getPlatforms();
    return NextResponse.json(platforms);
  } catch (error) {
    console.error('Failed to fetch platforms:', error);
    return NextResponse.json({ error: 'Failed to fetch platforms' }, { status: 500 });
  }
}
