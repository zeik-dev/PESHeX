import { Archive, BookOpen, Backpack, Globe2, History, LayoutDashboard, Monitor, ScanSearch, Settings, User, Users, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { ViewId } from "../stores/session";

export interface NavItem {
  id: ViewId;
  icon: ReactNode;
  /** Rol que debe existir en el save para mostrar la vista. */
  needs?: string;
}

export const NAV: NavItem[] = [
  { id: "overview", icon: <LayoutDashboard size={17} /> },
  { id: "trainer", icon: <User size={17} />, needs: "trainer" },
  { id: "party", icon: <Users size={17} />, needs: "trainer" },
  { id: "boxes", icon: <Monitor size={17} />, needs: "storage" },
  { id: "bag", icon: <Backpack size={17} />, needs: "bag" },
  { id: "pokedex", icon: <BookOpen size={17} /> },
  { id: "world", icon: <Globe2 size={17} /> },
  { id: "unclassified", icon: <ScanSearch size={17} /> },
  { id: "changes", icon: <History size={17} /> },
  { id: "backups", icon: <Archive size={17} /> },
  { id: "advanced", icon: <Wrench size={17} /> },
  { id: "settings", icon: <Settings size={17} /> },
];

export function visibleNav(roles: Record<string, unknown>): NavItem[] {
  return NAV.filter((n) => !n.needs || roles[n.needs]);
}
