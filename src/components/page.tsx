import type { ReactNode } from "react";

interface PageProps {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function Page({ title, description, actions, children }: PageProps) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-base-content/60">{description}</p>
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="card card-dash bg-base-100">
      <div className="card-body items-center py-12 text-center">
        <h2 className="card-title">{title}</h2>
        <p className="max-w-md text-base-content/60">{description}</p>
        {action && <div className="card-actions mt-2">{action}</div>}
      </div>
    </div>
  );
}
