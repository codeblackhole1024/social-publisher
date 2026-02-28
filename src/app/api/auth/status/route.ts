import { NextResponse } from 'next/server';
import { checkLoginStatus } from '@/lib/publishers/login';

export async function GET() {
  const status = {
    douyin: checkLoginStatus('douyin'),
    bilibili: checkLoginStatus('bilibili'),
    xiaohongshu: checkLoginStatus('xiaohongshu'),
    youtube: true, // YouTube is managed via Composio
  };

  return NextResponse.json(status);
}
