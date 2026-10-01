import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  onSubmit: () => void
  children: ReactNode
  footer: ReactNode
}

/** A dialog laid out as a form: Enter submits, Escape or a click outside closes. */
export function Modal({ title, onClose, onSubmit, children, footer }: ModalProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    formRef.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=range]), textarea')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit()
  }

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form ref={formRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit} noValidate>
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="mfoot">{footer}</div>
      </form>
    </div>
  )
}

export function Field({ label, full, children }: { label: ReactNode; full?: boolean; children: ReactNode }) {
  return (
    <label className={`field${full ? ' full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

/** Delete button that asks for a second click instead of a browser confirm(). */
export function DeleteButton({ label = 'Delete', onConfirm }: { label?: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  return (
    <button type="button" className="btn danger" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Click again to delete' : label}
    </button>
  )
}

export function FormError({ message }: { message: string }) {
  if (!message) return null
  return <p className="note error" role="alert">{message}</p>
}
