const paths: Readonly<Record<string, React.ReactNode>> = {
  area: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  project: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z" />,
  task: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  entry: (
    <>
      <path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5" />
      <path d="M8 12h8M8 16h6" />
    </>
  ),
  topic: <path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" />,
  resource: (
    <>
      <path d="M12 5v16M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2V4Z" />
    </>
  ),
};
export const EntityIcon = ({
  type,
  status,
}: {
  readonly type: string;
  readonly status?: string | null | undefined;
}): React.JSX.Element => (
  <svg
    className="entity-icon"
    data-entity-type={type}
    data-entity-status={status ?? undefined}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {type === "task" && status != null ? (
      <>
        <circle cx="12" cy="12" r="9" />
        {status === "in_progress" && (
          <path d="M12 6a6 6 0 0 1 0 12V6Z" fill="currentColor" stroke="none" />
        )}
        {status === "on_hold" && <path d="M9 8v8M15 8v8" />}
        {status === "done" && <path d="m8 12 3 3 5-6" />}
      </>
    ) : (
      (paths[type] ?? paths.entry)
    )}
  </svg>
);
