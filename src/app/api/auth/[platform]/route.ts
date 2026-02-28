import { NextResponse } from 'next/server';
import { loginToPlatform, checkLoginStatus, type Platform } from '@/lib/publishers/login';
import { updatePlatformLoginStatus } from '@/lib/db';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  
  if (!['douyin', 'bilibili', 'xiaohongshu', 'youtube'].includes(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  try {
    const result = await loginToPlatform(platform as Platform);
    
    if (result.success) {
      // Sync login status to Supabase DB upon successful login
      await updatePlatformLoginStatus(platform, true);
      return NextResponse.json({ success: true, message: result.message });
    } else {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
  } catch (error) {
    console.error(`Error logging into ${platform}:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  
  if (!['douyin', 'bilibili', 'xiaohongshu', 'youtube'].includes(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  const isLoggedIn = checkLoginStatus(platform as Platform);
  // Optional: Background sync, but not strictly required on GET if POST handles it
  
  return NextResponse.json({ isLoggedIn });
}
