import type { ReactNode } from "react";

export function PageTitle({ title }: { title: string }) {
  return (
    <h1 className="page-title">
      {title === "Competitions" ? (
        <>
          Compe
          <wbr />
          titions
        </>
      ) : (
        title
      )}
      <span className="text-accent" aria-hidden="true">
        .
      </span>
    </h1>
  );
}

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
        <PageTitle title={title} />
        <span
          className={`piste-mark ${title.length > 10 ? "hidden sm:flex" : ""}`}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </span>
      </div>
    </header>
  );
}
