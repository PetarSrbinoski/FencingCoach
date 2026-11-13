import type { ReactNode } from "react";

export function PageTitle({ title }: { title: string }) {
  return <h1 className="page-title">{title}</h1>;
}

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
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <PageTitle title={title} />
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
