import { useEffect, useRef } from "react";

export function NoorAccountReceipt({ copy, onDismiss, onReturn }: {
  copy: { title: string; details: readonly string[]; action: string };
  onDismiss: () => void;
  onReturn: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      returnButtonRef.current?.focus({ preventScroll: true });
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="noor-account-request-receipt"
      aria-labelledby="noor-account-request-receipt-title"
      aria-describedby="noor-account-request-receipt-details"
      onClose={onDismiss}
    >
      <button
        type="button"
        className="noor-account-request-receipt-close"
        aria-label="إغلاق"
        onClick={() => dialogRef.current?.close()}
      >
        <svg aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="m4 4 8 8m0-8-8 8" />
        </svg>
      </button>
      <span className="noor-account-request-receipt-check" aria-hidden="true">
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 10 4 4 8-8" />
        </svg>
      </span>
      <h2 id="noor-account-request-receipt-title">{copy.title}</h2>
      <div id="noor-account-request-receipt-details">
        {copy.details.map(detail => <p key={detail}>{detail}</p>)}
      </div>
      <button
        ref={returnButtonRef}
        type="button"
        className="noor-account-request-receipt-return"
        onClick={() => {
          dialogRef.current?.close();
          onReturn();
        }}
      >
        {copy.action}
      </button>
    </dialog>
  );
}
