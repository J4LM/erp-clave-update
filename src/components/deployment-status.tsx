import type { Deployment } from "@/lib/api";

const STATUS: Record<Deployment["status"], { label: string; badge: string }> = {
  ok: { label: "Correcto", badge: "badge-success" },
  restored: { label: "Fallido y restaurado", badge: "badge-warning" },
  failed: { label: "Fallido", badge: "badge-error" },
};

export function DeploymentStatus({ deployment }: { deployment: Deployment }) {
  const { label, badge } = STATUS[deployment.status];
  return (
    <span className={`badge badge-soft badge-sm whitespace-nowrap ${badge}`}>
      {label}
    </span>
  );
}

export const kindLabel = (deployment: Deployment) =>
  deployment.kind === "restore" ? "Restauración" : "Despliegue";
