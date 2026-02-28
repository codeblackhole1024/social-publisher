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

export async function getTasks(): Promise<PublishTask[]> {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) {
      console.error('Supabase error fetching tasks:', error);
      // Auto-fallback: If table doesn't exist, we just return empty array instead of crashing
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
      if (error.code === '42P01') {
        console.warn('Table "tasks" does not exist yet. Please create it with columns: id(text, PK), title(text), description(text), tags(text), platforms(jsonb), status(text), createdAt(text), results(jsonb).');
      }
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
