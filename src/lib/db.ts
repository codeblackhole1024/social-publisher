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
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string; // ISO string
  results: PublishResult[];
}

export interface SocialPlatform {
  id: string; // e.g., 'douyin', 'bilibili'
  name: string; // e.g., '抖音', 'B站'
  isConnected: boolean;
  lastLoginAt: string | null; // ISO Date String
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
      console.error('Supabase error fetching platforms:', error);
      return [];
    }

    // If table is empty, initialize defaults
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

    if (error) {
      if (error.code === '42P01') {
         console.warn('Table "platforms" does not exist yet. Please create it with columns: id(text, PK), name(text), isConnected(boolean), lastLoginAt(text).');
      } else {
         console.error('Supabase error updating platform login status:', error);
      }
    }
  } catch (err) {
    console.error('Error updating platform login to Supabase:', err);
  }
}

// ----------------------------------------------------
// Task Operations
// ----------------------------------------------------

export async function getTasks(): Promise<PublishTask[]> {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) {
      console.error('Supabase error fetching tasks:', error);
      if (error.code === '42P01') {
        console.warn('Table "tasks" does not exist yet. Please create it in Supabase dashboard.');
      }
      return [];
    }

    return (data || []) as PublishTask[];
  } catch (err) {
    console.error('Error reading tasks from Supabase:', err);
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
        results: task.results
      });

    if (error) {
      console.error('Supabase error saving task:', error);
    }
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
      console.error('Supabase error updating task:', error);
      return null;
    }
    return data as PublishTask;
  } catch (err) {
    console.error('Error updating task in Supabase:', err);
    return null;
  }
}
