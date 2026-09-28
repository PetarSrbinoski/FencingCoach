import type { ReactNode } from "react";

/** Compact editorial masthead: graphic character without a large mobile hero. */
export function PageHeading({
  title,
  eyebrow,
  action,
}: {
  title: string;
  eyebrow: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="eyebrow min-w-0">{eyebrow}</p>
        {action}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <h1 className={title.length > 10 ? "long-title" : undefined}>
          {title}
          <span className="text-accent" aria-hidden="true">
            .
          </span>
        </h1>
        <span className="piste-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </header>
  );
}
