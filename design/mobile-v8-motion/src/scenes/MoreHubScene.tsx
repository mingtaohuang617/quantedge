import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { PhoneFrame, SceneHeader } from "../PhoneFrame";

export const MoreHubScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#08090E" }}>
      <SceneHeader eyebrow="04 / HUB" title="低频能力集中管理" detail="固定、最近使用和系统状态都能快速到达" />
      <PhoneFrame activeTab="我的">
        <div style={{ padding: "60px 30px" }}>
          <div style={{ color: "#F5F7FA", fontSize: 31, fontWeight: 750 }}>更多</div>
          <div style={{ color: "#858C9C", fontSize: 18, marginTop: 9 }}>研究工具与系统设置</div>
          <div style={{ color: "#73798A", fontSize: 16, marginTop: 30, letterSpacing: 2 }}>已固定</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15, marginTop: 14 }}>
            {["回测引擎", "10×筛选", "智能贝塔", "因子挖掘"].map((label, index) => (
              <Interactive.Div key={label} name={label} style={{ padding: 22, height: 116, borderRadius: 24, border: "1px solid #2B303C", backgroundColor: "#151821", translate: interpolate(frame, [12 + index * 7, 36 + index * 7], ["0px 24px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.spring({ damping: 170 }) }), opacity: interpolate(frame, [12 + index * 7, 28 + index * 7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
                <div style={{ color: index === 0 ? "#1ED395" : "#5EE6E6", fontSize: 24 }}>◇</div><div style={{ color: "#F5F7FA", fontSize: 20, fontWeight: 680, marginTop: 11 }}>{label}</div>
              </Interactive.Div>
            ))}
          </div>
          <Interactive.Div name="System status row" style={{ marginTop: 28, padding: 22, borderRadius: 24, border: "1px solid #345044", backgroundColor: "#122019", display: "flex", alignItems: "center", justifyContent: "space-between", scale: interpolate(frame, [92, 106, 120], [1, 0.98, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.spring({ damping: 170 }), output: "perceptual-scale" }) }}>
            <div><div style={{ color: "#F5F7FA", fontSize: 20, fontWeight: 700 }}>系统状态</div><div style={{ color: "#74E5BC", fontSize: 16, marginTop: 7 }}>数据服务正常</div></div><div style={{ color: "#1ED395", fontSize: 28 }}>●</div>
          </Interactive.Div>
          <Interactive.Div name="Update row" style={{ marginTop: 14, padding: 22, borderRadius: 24, border: "1px solid #4C4228", backgroundColor: "#211D13", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: interpolate(frame, [112, 134], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            <div><div style={{ color: "#F5F7FA", fontSize: 20, fontWeight: 700 }}>可用更新</div><div style={{ color: "#C9AD70", fontSize: 16, marginTop: 7 }}>由用户决定何时刷新</div></div><div style={{ color: "#F5B53C", fontSize: 18, fontWeight: 740 }}>现在更新</div>
          </Interactive.Div>
        </div>
      </PhoneFrame>
    </AbsoluteFill>
  );
};
