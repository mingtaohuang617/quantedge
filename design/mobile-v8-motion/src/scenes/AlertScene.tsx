import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { PhoneFrame, SceneHeader } from "../PhoneFrame";

export const AlertScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#08090E" }}>
      <SceneHeader eyebrow="03 / FEEDBACK" title="操作必须可撤销" detail="滑动解决告警后，立即提供结果与反悔入口" />
      <PhoneFrame activeTab="监控">
        <div style={{ padding: "60px 30px" }}>
          <div style={{ color: "#F5F7FA", fontSize: 31, fontWeight: 750 }}>风险监控</div>
          <div style={{ color: "#FF7A8A", fontSize: 18, marginTop: 9 }}>2 项需要处理</div>
          <div style={{ position: "relative", marginTop: 34, height: 190, overflow: "hidden", borderRadius: 28, backgroundColor: "#512632" }}>
            <div style={{ position: "absolute", right: 28, top: 0, bottom: 0, display: "grid", placeItems: "center", color: "#FFD6DC", fontSize: 21, fontWeight: 730 }}>标记解决</div>
            <Interactive.Div name="Swipe alert card" style={{ position: "absolute", inset: 0, padding: 25, borderRadius: 28, border: "1px solid #51303A", backgroundColor: "#191820", translate: interpolate(frame, [35, 76], ["0px 0px", "-190px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), opacity: interpolate(frame, [74, 94], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><div style={{ color: "#FF7A8A", fontSize: 17 }}>严重 · 回撤告警</div><div style={{ color: "#73798A", fontSize: 16 }}>刚刚</div></div>
              <div style={{ marginTop: 16, color: "#F5F7FA", fontSize: 24, fontWeight: 730 }}>NVDA 突破风险阈值</div><div style={{ color: "#9BA1B0", fontSize: 17, marginTop: 10 }}>当前回撤 -8.4%，阈值 -7.0%</div>
            </Interactive.Div>
          </div>
          <Interactive.Div name="Resolved state" style={{ marginTop: -190, height: 190, padding: 25, borderRadius: 28, border: "1px solid #285544", backgroundColor: "#10231C", opacity: interpolate(frame, [89, 106], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            <div style={{ color: "#74E5BC", fontSize: 18 }}>✓ 已标记解决</div><div style={{ marginTop: 18, color: "#F5F7FA", fontSize: 24, fontWeight: 730 }}>NVDA 风险告警</div><div style={{ marginTop: 10, color: "#9BA1B0", fontSize: 17 }}>记录已同步到操作日志</div>
          </Interactive.Div>
          <Interactive.Div name="Undo toast" style={{ position: "absolute", left: 30, right: 30, bottom: 34, padding: "20px 23px", borderRadius: 22, border: "1px solid #38404E", backgroundColor: "#20242E", display: "flex", justifyContent: "space-between", color: "#F5F7FA", fontSize: 19, translate: interpolate(frame, [104, 126], ["0px 100px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.spring({ damping: 180 }) }), opacity: interpolate(frame, [104, 116], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            告警已解决 <span style={{ color: "#5EE6E6", fontWeight: 740 }}>撤销</span>
          </Interactive.Div>
        </div>
      </PhoneFrame>
    </AbsoluteFill>
  );
};
