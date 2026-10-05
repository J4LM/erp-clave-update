import { useEffect, useRef, type ReactNode } from "react";
import type { AnyFieldApi } from "@tanstack/react-form";

export const requiredText =
  (message: string) =>
  ({ value }: { value: string }) =>
    value.trim() ? undefined : message;

interface TextFieldProps {
  field: AnyFieldApi;
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  hint?: string;
  /** Se muestra junto al campo, por ejemplo un botón de examinar. */
  action?: ReactNode;
}

export function TextField({
  field,
  label,
  type = "text",
  placeholder,
  hint,
  action,
}: TextFieldProps) {
  const { errors, isTouched } = field.state.meta;
  const error = isTouched && errors.length > 0 ? String(errors[0]) : null;

  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">{label}</legend>
      <div className="flex gap-2">
        <input
          type={type}
          className={`input w-full ${error ? "input-error" : ""}`}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.value)}
        />
        {action}
      </div>
      {error ? (
        <p className="label text-error">{error}</p>
      ) : (
        hint && <p className="label whitespace-normal">{hint}</p>
      )}
    </fieldset>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (error == null) return null;
  return (
    <div role="alert" className="alert alert-error alert-soft">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

interface DialogProps {
  title: string;
  onClose: () => void;
  /** Impide cerrar el modal, por ejemplo durante una operación en curso. */
  locked?: boolean;
  children: ReactNode;
}

/** Modal que permanece abierto mientras está montado. */
export function Dialog({ title, onClose, locked, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    // El modo estricto ejecuta los efectos dos veces; showModal falla si ya está abierto.
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      onClose={onClose}
      onCancel={(event) => {
        if (locked) event.preventDefault();
      }}
    >
      <div className="modal-box">
        <h3 className="mb-2 text-lg font-semibold">{title}</h3>
        {children}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button disabled={locked}>Cerrar</button>
      </form>
    </dialog>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  isPending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  isPending,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="text-base-content/70">{message}</p>
      <div className="mt-4">
        <ErrorAlert error={error} />
      </div>
      <div className="modal-action">
        <button className="btn" onClick={onClose} disabled={isPending}>
          Cancelar
        </button>
        <button className="btn btn-error" onClick={onConfirm} disabled={isPending}>
          {isPending && <span className="loading loading-spinner loading-sm" />}
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

interface ProgressBarProps {
  /** `null` mientras aún no se conoce el total. */
  progress: { done: number; total: number; path: string } | null;
}

export function ProgressBar({ progress }: ProgressBarProps) {
  if (!progress) {
    return <progress className="progress w-full" />;
  }
  return (
    <div className="flex flex-col gap-1">
      <progress
        className="progress w-full"
        value={progress.done}
        max={Math.max(progress.total, 1)}
      />
      <div className="flex justify-between gap-4 text-xs text-base-content/60">
        <span className="truncate font-mono">{progress.path}</span>
        <span className="shrink-0">
          {progress.done} de {progress.total}
        </span>
      </div>
    </div>
  );
}
