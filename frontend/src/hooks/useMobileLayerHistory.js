import { useEffect, useRef } from "react";

export default function useMobileLayerHistory(open, onClose, layerKey) {
  const pushedRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const marker = `qe:${layerKey}`;
    if (!pushedRef.current) {
      window.history.pushState({ ...(window.history.state || {}), qeLayer: marker }, "", window.location.href);
      pushedRef.current = true;
    }
    const onPopState = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      closeRef.current?.();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open, layerKey]);

  useEffect(() => () => {
    pushedRef.current = false;
  }, []);

  return () => {
    if (pushedRef.current && window.history.state?.qeLayer === `qe:${layerKey}`) {
      window.history.back();
    } else {
      pushedRef.current = false;
      closeRef.current?.();
    }
  };
}
