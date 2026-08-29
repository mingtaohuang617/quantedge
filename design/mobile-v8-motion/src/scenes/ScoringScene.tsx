import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { PhoneFrame, SceneHeader } from "../PhoneFrame";

export const ScoringScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#08090E" }}>
      <SceneHeader eyebrow="02 / DETAIL" title="列表保留上下文" detail="进入详情、系统返回、继续浏览形成闭环" />
      <PhoneFrame activeTab="评分">
        <Interactive.Div name="Score list" style={{ position: "absolute", inset: 0, padding: "60px 30px", opacity: interpolate(frame, [55, 78], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), translate: interpolate(frame, [55, 86], ["0px 0px", "-120px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.4, 0, 1, 1) }) }}>
          <div style={{ color: "#F5F7FA", fontSize: 31, fontWeight: 750 }}>评分雷达</div>
          <div style={{ color: "#858C9C", fontSize: 18, marginTop: 9 }}>按综合得分排序 · 36 个标的</div>
          {[{t:"NVDA",s:91,p:"$126.09"},{t:"TSM",s:87,p:"$174.32"},{t:"MSFT",s:82,p:"$441.16"}].map((row, index) => (
            <Interactive.Div key={row.t} name={`${row.t} score card`} style={{ marginTop: index === 0 ? 30 : 16, padding: 24, borderRadius: 26, border: index === 0 ? "1px solid #276950" : "1px solid #2B303C", backgroundColor: index === 0 ? "#11241D" : "#151821", scale: index === 0 ? interpolate(frame, [22, 34, 46], [1, 0.97, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.spring({ damping: 170 }), output: "perceptual-scale" }) : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ color: "#F5F7FA", fontSize: 25, fontWeight: 740 }}>{row.t}</div><div style={{ color: "#858C9C", fontSize: 17, marginTop: 6 }}>{row.p}</div></div><div style={{ width: 70, height: 70, borderRadius: 40, display: "grid", placeItems: "center", border: "6px solid #1ED395", color: "#F5F7FA", fontSize: 24, fontWeight: 760 }}>{row.s}</div></div>
            </Interactive.Div>
          ))}
        </Interactive.Div>
        <Interactive.Div name="NVDA detail" style={{ position: "absolute", inset: 0, padding: "58px 30px", backgroundColor: "#0E1017", translate: interpolate(frame, [62, 94], ["600px 0px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.spring({ damping: 180 }) }) }}>
          <div style={{ display: "flex", gap: 18, alignItems: "center", color: "#F5F7FA" }}><div style={{ width: 50, height: 50, borderRadius: 25, display: "grid", placeItems: "center", backgroundColor: "#20242E", fontSize: 28 }}>‹</div><div style={{ fontSize: 28, fontWeight: 750 }}>NVDA 评分详情</div></div>
          <div style={{ marginTop: 36, padding: 28, borderRadius: 30, border: "1px solid #2B303C", backgroundColor: "#151821" }}>
            <div style={{ color: "#858C9C", fontSize: 18 }}>综合评分</div><div style={{ color: "#1ED395", fontSize: 74, fontWeight: 780, letterSpacing: -4 }}>91</div>
            <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>{[["质量","94"],["动量","89"],["估值","76"],["风险","88"]].map(([k,v]) => <div key={k} style={{ padding: 18, borderRadius: 20, backgroundColor: "#1B1E28" }}><div style={{ color: "#858C9C", fontSize: 16 }}>{k}</div><div style={{ color: "#F5F7FA", fontSize: 27, fontWeight: 730, marginTop: 5 }}>{v}</div></div>)}</div>
          </div>
          <div style={{ marginTop: 22, color: "#9BA1B0", fontSize: 18, lineHeight: 1.65 }}>返回后仍停留在原排序位置，筛选条件和滚动位置不会丢失。</div>
        </Interactive.Div>
      </PhoneFrame>
    </AbsoluteFill>
  );
};
