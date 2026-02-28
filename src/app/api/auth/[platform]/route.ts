import { NextResponse } from 'next/server';
import { loginToPlatform, checkLoginStatus, type Platform } from '@/lib/publishers/login';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  
  if (!['douyin', 'bilibili', 'xiaohongshu'].includes(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  try {
    const result = await loginToPlatform(platform as Exclude<Platform, 'youtube'>);
    
    if (result.success) {
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
  
  if (!['douyin', 'bilibili', 'xiaohongshu'].includes(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }

  const isLoggedIn = checkLoginStatus(platform as Exclude<Platform, 'youtube'>);
  return NextResponse.json({ isLoggedIn });
}
