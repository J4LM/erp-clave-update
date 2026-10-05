import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-base-200">
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body items-center text-center">
          <h1 className="card-title text-2xl">ERP Clave Update</h1>
          <p>Tauri + React + TanStack + Tailwind + daisyUI</p>
          <button className="btn btn-primary">Empezar</button>
        </div>
      </div>
    </main>
  );
}
