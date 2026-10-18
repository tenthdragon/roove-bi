import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
const Navigation = createContext({
  url: new URL("http://localhost/"),
  navigate: (_url: string) => {},
});
export function FixtureNavigation({ children }: { children: ReactNode }) {
  const [url, setUrl] = useState(() => new URL(window.location.href));
  const navigate = (value: string) => {
    const next = new URL(value, window.location.href);
    history.replaceState(null, "", next);
    setUrl(next);
  };
  return (
    <Navigation.Provider value={{ url, navigate }}>
      {children}
    </Navigation.Provider>
  );
}
export function usePathname() {
  return "/dashboard/growth-work";
}
export function useRouter() {
  const { navigate } = useContext(Navigation);
  return useMemo(() => ({ replace: navigate, push: navigate }), [navigate]);
}
export function useSearchParams() {
  return useContext(Navigation).url.searchParams;
}
export default function Link({
  href,
  children,
  ...rest
}: {
  href: string;
  children: ReactNode;
  [key: string]: unknown;
}) {
  const { navigate } = useContext(Navigation);
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
