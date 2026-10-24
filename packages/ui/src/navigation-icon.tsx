const paths = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  back: <path d="m12 5-7 7 7 7M5 12h14" />,
  forward: <path d="m12 5 7 7-7 7M5 12h14" />,
  home: <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </>
  ),
};

export const NavigationIcon = ({
  kind,
}: {
  readonly kind: keyof typeof paths;
}): React.JSX.Element => (
  <svg
    className="navigation-icon"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {paths[kind]}
  </svg>
);
