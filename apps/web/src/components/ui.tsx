import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

/** Small set of building blocks styled with the POC's tokens. */

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        {sub && <p className="text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-card ${className}`}>
      {(title || actions) && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="flex-1 font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type BtnVariant = 'primary' | 'default' | 'danger' | 'ghost';
const btn: Record<BtnVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-d border-brand',
  default: 'bg-white text-ink hover:bg-bg border-line',
  danger: 'bg-white text-red-700 hover:bg-red-50 border-red-200',
  ghost: 'bg-transparent text-brand hover:bg-bg border-transparent',
};

export function Button({ variant = 'default', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      type="button"
      {...p}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${btn[variant]} ${className}`}
    />
  );
}

export const inputCls = 'w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-brand disabled:bg-bg';

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ''}`} />;

export function Select({ options, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: [string, string][] }) {
  return (
    <select {...p} className={`${inputCls} ${p.className ?? ''}`}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

const tones = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
  gray: 'bg-slate-100 text-slate-700',
} as const;
export function Badge({ tone = 'gray', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export const statusTone = (s: string): keyof typeof tones => ({ Active: 'green', Temporary: 'blue', Left: 'red', Alumni: 'gray', Inactive: 'gray' })[s] as keyof typeof tones ?? 'gray';

export function Tabs<T extends string>({ items, value, onChange }: { items: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {items.map(([k, l]) => (
        <button
          key={k}
          role="tab"
          aria-selected={k === value}
          onClick={() => onChange(k)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap ${k === value ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, onRowClick, empty = 'Nothing here yet' }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; empty?: string }) {
  if (!rows.length) return <div className="py-10 text-center text-muted">{empty}</div>;
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-max text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs tracking-wide text-muted uppercase">
            {columns.map((c) => (
              <th key={c.header} className={`px-4 py-2 font-semibold ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={`border-b border-line last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-bg' : ''}`}>
              {columns.map((c) => (
                <td key={c.header} className={`px-4 py-2.5 ${c.className ?? ''}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[90vh] w-full flex-col rounded-card bg-white shadow-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-center border-b border-line px-5 py-3">
          <h3 className="flex-1 text-lg font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-bg">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
      {(error as Error).message}
    </p>
  );
}

export const Loading = () => <div className="py-10 text-center text-muted">Loading…</div>;

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center gap-2 text-sm text-muted">
      <span className="flex-1">
        {total ? `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}` : '0 results'}
      </span>
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Prev
      </Button>
      <span>
        {page} / {pages}
      </span>
      <Button disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next ›
      </Button>
    </div>
  );
}
