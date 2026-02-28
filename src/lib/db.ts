import fs from 'fs';
import path from 'path';

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

const DB_FILE = path.join(process.cwd(), 'data', 'tasks.json');

// Ensure DB file exists
if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

export function getTasks(): PublishTask[] {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const tasks = JSON.parse(data);
    return tasks.sort((a: PublishTask, b: PublishTask) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    console.error('Error reading tasks from DB:', err);
    return [];
  }
}

export function saveTask(task: PublishTask) {
  try {
    const tasks = getTasks();
    const existingIndex = tasks.findIndex(t => t.id === task.id);
    if (existingIndex !== -1) {
      tasks[existingIndex] = task;
    } else {
      tasks.push(task);
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(tasks, null, 2));
  } catch (err) {
    console.error('Error writing task to DB:', err);
  }
}

export function updateTask(id: string, updates: Partial<PublishTask>) {
  const tasks = getTasks();
  const index = tasks.findIndex(t => t.id === id);
  if (index !== -1) {
    tasks[index] = { ...tasks[index], ...updates };
    fs.writeFileSync(DB_FILE, JSON.stringify(tasks, null, 2));
    return tasks[index];
  }
  return null;
}
