import { buildGuide } from "./repository";

const contents: Record<string, string> = {
  "README.md":
    "# Taskflow\n\nA small example task board for learning React, TypeScript, and Express.\n\nThis is an illustrative repository bundled with Peritia, not an imported GitHub project.\n\n## How it works\nThe React screen requests tasks from an Express API. A task can be marked complete. This example uses an in-memory array; tasks reset when the server restarts.\n\n## Local development\nInstall dependencies with npm install, run npm run dev for the interface and npm run server for the API.\n",
  "package.json": JSON.stringify(
    {
      name: "taskflow",
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        server: "tsx server/index.ts",
        build: "tsc && vite build",
      },
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        express: "^5.1.0",
      },
      devDependencies: { typescript: "^5.9.0", vite: "^7.0.0", tsx: "^4.0.0" },
    },
    null,
    2,
  ),
  "index.html":
    '<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>Taskflow</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>',
  "src/main.tsx":
    'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\nconst root = document.getElementById("root");\nif (root) createRoot(root).render(<App />);',
  "src/App.tsx":
    'import { useTasks } from "./hooks/useTasks";\nimport { TaskCard } from "./components/TaskCard";\n\nexport default function App() {\n  const { tasks, error, loading, complete } = useTasks();\n  if (loading) return <p>Loading tasks…</p>;\n  if (error) return <p role="alert">{error}</p>;\n  return <main><h1>Your tasks</h1>{tasks.map(task =>\n    <TaskCard key={task.id} task={task} onComplete={() => complete(task.id)} />\n  )}</main>;\n}',
  "src/components/TaskCard.tsx":
    'import type { Task } from "../types";\n\nexport function TaskCard({ task, onComplete }: { task: Task; onComplete: () => void }) {\n  return <article>\n    <h2>{task.title}</h2>\n    <button disabled={task.done} onClick={onComplete}>\n      {task.done ? "Completed" : "Mark complete"}\n    </button>\n  </article>;\n}',
  "src/hooks/useTasks.ts":
    'import { useEffect, useState } from "react";\nimport { fetchTasks, completeTask } from "../lib/api";\nimport type { Task } from "../types";\n\nexport function useTasks() {\n  const [tasks, setTasks] = useState<Task[]>([]);\n  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState("");\n  useEffect(() => {\n    let active = true;\n    fetchTasks().then(data => { if (active) setTasks(data); })\n      .catch(() => { if (active) setError("Could not load tasks."); })\n      .finally(() => { if (active) setLoading(false); });\n    return () => { active = false; };\n  }, []);\n  async function complete(id: number) {\n    try {\n      const updated = await completeTask(id);\n      setTasks(current => current.map(t => t.id === id ? updated : t));\n    } catch { setError("Could not update task."); }\n  }\n  return { tasks, loading, error, complete };\n}',
  "src/lib/api.ts":
    'import type { Task } from "../types";\n\nexport async function fetchTasks(): Promise<Task[]> {\n  const response = await fetch("/api/tasks");\n  if (!response.ok) throw new Error("Request failed");\n  return response.json();\n}\n\nexport async function completeTask(id: number): Promise<Task> {\n  const response = await fetch(`/api/tasks/${id}`, { method: "PATCH" });\n  if (!response.ok) throw new Error("Update failed");\n  return response.json();\n}',
  "src/types.ts":
    "export type Task = {\n  id: number;\n  title: string;\n  done: boolean;\n};",
  "src/styles.css":
    "body { font-family: system-ui; margin: 0; background: #f7f9f8; }\nmain { max-width: 720px; margin: 3rem auto; padding: 1rem; }\narticle { background: white; padding: 1.5rem; margin-bottom: 1rem; }\nbutton { padding: 0.75rem; cursor: pointer; }",
  "server/index.ts":
    'import express from "express";\nimport { tasksRouter } from "./routes/tasks";\n\nconst app = express();\napp.use(express.json());\napp.use("/api/tasks", tasksRouter);\napp.listen(3001);',
  "server/routes/tasks.ts":
    'import { Router } from "express";\nimport { tasks } from "../data";\n\nexport const tasksRouter = Router();\ntasksRouter.get("/", (_req, res) => { res.json(tasks); });\ntasksRouter.patch("/:id", (req, res) => {\n  const task = tasks.find(t => t.id === Number(req.params.id));\n  if (!task) { res.status(404).json({ error: "Task not found" }); return; }\n  task.done = true;\n  res.json(task);\n});',
  "server/data.ts":
    'import type { Task } from "../src/types";\n\n// In-memory demo data, not a persistent database.\nexport const tasks: Task[] = [\n  { id: 1, title: "Explore the repository", done: false },\n  { id: 2, title: "Follow an API request", done: false }\n];',
  "vite.config.ts":
    'import { defineConfig } from "vite";\n\nexport default defineConfig({\n  server: { proxy: { "/api": "http://localhost:3001" } }\n});',
  "tsconfig.json":
    '{\n  "compilerOptions": {\n    "strict": true, "jsx": "react-jsx", "moduleResolution": "bundler",\n    "module": "ESNext", "target": "ES2022", "noEmit": true,\n    "esModuleInterop": true\n  },\n  "include": ["src", "server", "vite.config.ts"]\n}',
};
export const demoGuide = buildGuide({
  owner: "example",
  name: "taskflow",
  description:
    "A small task board with a React interface and an Express API. Follow a task from the screen to the server, one file at a time.",
  branch: "main",
  commit: "sample",
  url: "https://github.com",
  stars: 0,
  files: Object.entries(contents).map(([path, content]) => ({
    path,
    type: "blob" as const,
    size: content.length,
    sha: "sample",
  })),
  sources: Object.entries(contents).map(([path, content]) => ({
    path,
    content,
  })),
  warnings: [],
  analyzedAt: "",
  sample: true,
});
