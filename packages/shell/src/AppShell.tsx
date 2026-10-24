import { useState, type ReactNode } from "react";

export type ShellNavState = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
};

export type AppShellProps = {
  sidebar: (state: ShellNavState) => ReactNode;
  header: (state: ShellNavState) => ReactNode;
  banner?: ReactNode;
  stripe?: ReactNode;
  children: ReactNode;
};

export function AppShell({ sidebar, header, banner, stripe, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const nav = { sidebarOpen, setSidebarOpen };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {stripe}
      {sidebar(nav)}
      <div className="relative flex flex-col flex-1 overflow-x-hidden">
        {header(nav)}
        {banner}
        <main className="grow overflow-y-auto rounded-tl-xl bg-card shadow-[inset_1px_1px_0_rgba(0,0,0,0.03),inset_0_1px_4px_rgba(0,0,0,0.04)] dark:shadow-[inset_1px_1px_0_rgba(255,255,255,0.03),inset_0_2px_8px_rgba(0,0,0,0.3)]">
          {children}
        </main>
      </div>
    </div>
  );
}
