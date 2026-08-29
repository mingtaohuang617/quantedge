import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { PhoneFrame, SceneHeader } from "../PhoneFrame";

export const SystemScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#08090E" }}>
      <SceneHeader eyebrow="01 / SYSTEM" title="状态先于装饰" detail="在线、离线和更新都有明确出口" />
      <PhoneFrame activeTab="评分">
        <div style={{ padding: "62px 30px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: "#F5F7FA", fontSize: 31, fontWeight: 750 }}>QuantEdge</div>
            <Interactive.Div
              name="Live status"
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                padding: "12px 16px",
                borderRadius: 22,
                border: "1px solid #245A49",
                backgroundColor: "#10251E",
                color: "#74E5BC",
                fontSize: 18,
                opacity: interpolate(frame, [6, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }),
              }}
            >
              <span style={{ width: 12, height: 12, borderRadius: 8, backgroundColor: "#1ED395" }} /> 数据已同步
            </Interactive.Div>
          </div>
          <Interactive.Div
            name="Market pulse card"
            style={{
              marginTop: 36,
              padding: 26,
              borderRadius: 30,
              border: "1px solid #2B303C",
              backgroundColor: "#151821",
              translate: interpolate(frame, [18, 42], ["0px 30px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.spring({ damping: 160 }) }),
              opacity: interpolate(frame, [18, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            <div style={{ color: "#868D9F", fontSize: 18 }}>今日量化脉搏</div>
            <div style={{ marginTop: 8, color: "#F5F7FA", fontSize: 42, fontWeight: 760 }}>68.4</div>
            <div style={{ marginTop: 22, height: 110, display: "flex", alignItems: "end", gap: 9 }}>
              {[38, 57, 44, 71, 62, 88, 79, 96, 83, 108].map((h, index) => (
                <div key={index} style={{ flex: 1, height: h, borderRadius: "7px 7px 2px 2px", backgroundColor: index > 6 ? "#1ED395" : "#303645" }} />
              ))}
            </div>
          </Interactive.Div>
          <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {["服务正常", "有新版本"].map((label, index) => (
              <Interactive.Div key={label} name={label} style={{ padding: 22, borderRadius: 24, border: "1px solid #2B303C", backgroundColor: "#13151E", color: index === 0 ? "#F5F7FA" : "#F5B53C", fontSize: 20 }}>
                <div style={{ color: "#73798A", fontSize: 16, marginBottom: 9 }}>{index === 0 ? "系统" : "应用"}</div>{label}
              </Interactive.Div>
            ))}
          </div>
        </div>
      </PhoneFrame>
    </AbsoluteFill>
  );
};
