import { NavLink } from "react-router-dom";
import { BornMascot } from "../brand/BornMascot";

const links = [
  { to: "/app/mix", label: "Mix", index: "01" },
  { to: "/app/launch", label: "Launch", index: "02" },
  { to: "/app/explore", label: "Explore", index: "03" },
  { to: "/safety", label: "Safety", index: "04" },
];

export function AppSidebar() {
  return (
    <aside className="app-rail" aria-label="App">
      <p className="rail-label">The lab</p>
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) => `rail-link${isActive ? " is-active" : ""}`}
        >
          <span className="rail-index">{link.index}</span>
          {link.label}
        </NavLink>
      ))}
      <div className="rail-foot">
        <BornMascot variant="portrait" state="idle" quiet className="bare rail-figure" />
        <p className="metric-label">BORN is on shift. He does not hold your keys.</p>
      </div>
    </aside>
  );
}

export function MobileBottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <NavLink to="/app/mix" className={({ isActive }) => (isActive ? "active" : "")}>
        Mix
      </NavLink>
      <NavLink to="/app/launch" className={({ isActive }) => (isActive ? "active" : "")}>
        Launch
      </NavLink>
      <NavLink to="/app/explore" className={({ isActive }) => (isActive ? "active" : "")}>
        Explore
      </NavLink>
    </nav>
  );
}
