import { useState, useEffect } from "react";

// 与 Tailwind `md` 断点对齐：视口 < 768px 视为移动端。
// 用 matchMedia 监听，旋转 / 改窗口尺寸都会实时切换。
const QUERY = "(max-width: 767.5px)";

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(QUERY).matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    // addEventListener 现代浏览器；addListener 兼容 Safari < 14
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  return isMobile;
}
