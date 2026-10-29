import type { ReactNode } from "react";

/** A settings item: title and one line of description on the left, the control on the right. */
export default function Row({
  title,
  desc,
  children,
  below,
}: {
  title: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
  /** A note under the row, e.g. a conflict warning. */
  below?: ReactNode;
}) {
  return (
    <div className="row">
      <span className="row-main">
        <span className="row-text">
          <span className="row-title">{title}</span>
          {desc && <span className="row-desc">{desc}</span>}
        </span>
        <span className="row-end">{children}</span>
      </span>
      {below}
    </div>
  );
}
