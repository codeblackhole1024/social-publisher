import { supabase } from './supabase';

export interface PublishResult {
  platform: string;
  success: boolean;
  message: string;
  logs: string[];
  screenshots: string[]; // URL paths e.g., /debug/filename.png
}

export interface PublishTask {
  id: string;
  title: string;
  description: string;
  tags: string;
  platforms: string[];
  status: 'pending' | 'processing' | 'requires_verification' | 'completed' | 'failed';
  createdAt: string; // ISO string
  results: PublishResult[];
  // Interactive Verification Fields
  requiresVerification?: boolean;
  verificationPlatform?: string | null;
  verificationCode?: string | null;
}

export interface SocialPlatform {
  id: string;
  name: string;
  isConnected: boolean;
  lastLoginAt: string | null; 
}

// ----------------------------------------------------
// Platform Operations
// ----------------------------------------------------

export async function getPlatforms(): Promise<SocialPlatform[]> {
  try {
    const { data, error } = await supabase
      .from('platforms')
      .select('*');

    if (error) {
      if (error.code === '42P01') {
        console.warn('Table "platforms" does not exist yet. Using defaults.');
        return [
          { id: 'douyin', name: '抖音', isConnected: false, lastLoginAt: null },
          { id: 'bilibili', name: 'B站', isConnected: false, lastLoginAt: null },
          { id: 'xiaohongshu', name: '小红书', isConnected: false, lastLoginAt: null },
          { id: 'youtube', name: 'YouTube', isConnected: false, lastLoginAt: null },
        ];
      }
      return [];
    }

    if (!data || data.length === 0) {
      const defaultPlatforms = [
        { id: 'douyin', name: '抖音', isConnected: false, lastLoginAt: null },
        { id: 'bilibili', name: 'B站', isConnected: false, lastLoginAt: null },
        { id: 'xiaohongshu', name: '小红书', isConnected: false, lastLoginAt: null },
        { id: 'youtube', name: 'YouTube', isConnected: false, lastLoginAt: null },
      ];
      await supabase.from('platforms').insert(defaultPlatforms);
      return defaultPlatforms;
    }

    return data as SocialPlatform[];
  } catch (err) {
    console.error('Error reading platforms from Supabase:', err);
    return [];
  }
}

export async function updatePlatformLoginStatus(platformId: string, isConnected: boolean) {
  try {
    const { error } = await supabase
      .from('platforms')
      .update({
        isConnected,
        lastLoginAt: isConnected ? new Date().toISOString() : null,
      })
      .eq('id', platformId);
  } catch (err) {
    console.error('Error updating platform login to Supabase:', err);
  }
}

// ----------------------------------------------------
// Task Operations
// ----------------------------------------------------

export async function getTask(id: string): Promise<PublishTask | null> {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return data as PublishTask;
  } catch (err) {
    return null;
  }
}

export async function getTasks(): Promise<PublishTask[]> {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) {
      return [];
    }
    return (data || []) as PublishTask[];
  } catch (err) {
    return [];
  }
}

export async function saveTask(task: PublishTask) {
  try {
    const { error } = await supabase
      .from('tasks')
      .upsert({
        id: task.id,
        title: task.title,
        description: task.description,
        tags: task.tags,
        platforms: task.platforms,
        status: task.status,
        createdAt: task.createdAt,
        results: task.results,
        requiresVerification: task.requiresVerification || false,
        verificationPlatform: task.verificationPlatform || null,
        verificationCode: task.verificationCode || null
      });
  } catch (err) {
    console.error('Error writing task to Supabase:', err);
  }
}

export async function updateTask(id: string, updates: Partial<PublishTask>) {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error(`[DB] updateTask(${id}) FAILED:`, error.message, JSON.stringify(updates));
      return null;
    }
    console.log(`[DB] updateTask(${id}) OK -> status=${(data as any)?.status}`);
    return data as PublishTask;
  } catch (err: any) {
    console.error(`[DB] updateTask(${id}) EXCEPTION:`, err.message);
    return null;
  }
}
