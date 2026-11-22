import { useCallback, useEffect, useState } from "react";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";
import { Rules } from "./pages/Rules";

export function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    history.pushState(null, "", to);
    setPath(new URL(to, location.origin).pathname);
    scrollTo(0, 0);
  }, []);

  const room = path.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/);
  if (room) return <RoomPage key={room[1].toUpperCase()} code={room[1].toUpperCase()} navigate={navigate} />;
  if (path === "/rules") return <Rules navigate={navigate} />;
  return <Home navigate={navigate} />;
}
